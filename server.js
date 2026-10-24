'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const Board   = require('./public/board-core.js');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 3000;

const COLORS     = ['red', 'blue', 'white', 'orange'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const rooms      = {};

// ── Room helpers ─────────────────────────────────────────────────────────────
function genCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join('');
  } while (rooms[code]);
  return code;
}

function buildOpeningOrder(colors) {
  return [...colors, ...[...colors].reverse()];
}

function getRoom(socket) {
  return socket.roomCode ? rooms[socket.roomCode] : null;
}

function connectedColors(room) {
  return COLORS.filter(c => Object.values(room.players).some(p => p.color === c && p.connected));
}

function nextColor(room) {
  const used = new Set(Object.values(room.players).map(p => p.color));
  return COLORS.find(c => !used.has(c)) || null;
}

function socketIdForColor(room, color) {
  const p = Object.values(room.players).find(pl => pl.color === color);
  return p && p.connected ? p.socketId : null;
}

// Each browser tab sends a random seat key, kept across refreshes, so a player
// who reloads or loses connection gets their own seat back.
function validToken(token) {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(token);
}

function robberBlockReason(board) {
  const tp = board.gameState.turnPhase;
  if (tp === 'discard') return 'players must discard before continuing';
  if (tp === 'robber')  return 'move the robber before continuing';
  return null;
}

function playersPayload(room) {
  return COLORS
    .filter(c => Object.values(room.players).some(p => p.color === c))
    .map(c => {
      const p = Object.values(room.players).find(pl => pl.color === c);
      return { color: c, connected: p.connected };
    });
}

function broadcast(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.board) return;
  io.to(roomCode).emit('state', { board: room.board, rollLog: room.rollLog, serverTime: Date.now() });
}

// Newest first; '---' marks the end of a turn.
function addLog(room, text) {
  room.rollLog.unshift(text);
  if (room.rollLog.length > 100) room.rollLog.length = 100;
}

function broadcastPlayersUpdate(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  io.to(roomCode).emit('players_update', { players: playersPayload(room), hostColor: room.hostColor });
}

function actionError(socket, reason) {
  socket.emit('action_error', { reason });
}

function scheduleCleanup(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => { delete rooms[roomCode]; }, 5 * 60 * 1000);
}

function cancelCleanup(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.cleanupTimer) return;
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = null;
}

function freshBoard(room, balanced) {
  const b      = Board.generateBoard(undefined, room.mapId, balanced);
  const colors = connectedColors(room);
  b.gameState.playerOrder        = colors;
  b.gameState.openingOrder       = buildOpeningOrder(colors);
  b.gameState.openingTurn        = 0;
  b.gameState.currentPlayerIndex = 0;
  b.gameState.winTarget          = room.winTarget || 10;
  b.players = {};
  for (const c of colors) b.players[c] = { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 };
  return b;
}

// ── Action handler ───────────────────────────────────────────────────────────
const TURN_ACTIONS = new Set([
  'roll_dice', 'place_settlement', 'place_city', 'place_road', 'end_turn', 'trade_with_bank',
]);

function handleAction(socket, action) {
  const room = getRoom(socket);
  if (!room)         return actionError(socket, 'not in a room');
  if (!room.started) return actionError(socket, 'game has not started');

  let { board }     = room;
  const myColor     = socket.playerColor;
  const log         = text => addLog(room, text);
  const logIfWon    = () => {
    if (Board.checkWinner(board) && !room.winLogged) {
      room.winLogged = true;
      log(`${board.gameState.winner} won the game!`);
    }
  };

  if (TURN_ACTIONS.has(action.type)) {
    const currentPlayer = Board.getCurrentPlayer(board);
    if (myColor !== currentPlayer) return actionError(socket, "it's not your turn");
  }

  switch (action.type) {

    case 'roll_dice': {
      if (board.gameState.phase !== 'main')      return actionError(socket, 'not in main phase');
      if (board.gameState.turnPhase !== 'roll')  return actionError(socket, 'already rolled this turn');
      const roll   = Board.rollDice();
      const result = Board.distributeResources(board, roll.total);
      board.gameState.diceRolled = true;
      board.lastRoll = roll;
      const stats = board.gameState.stats;
      if (stats) stats.rolls[roll.total] = (stats.rolls[roll.total] || 0) + 1;
      log(`${myColor} rolled ${roll.d1}+${roll.d2}`);

      if (roll.total === 7) {
        const discards = result.discards || {};
        const colors   = Object.keys(discards);
        board.gameState.pendingDiscards = discards;
        board.gameState.turnPhase       = colors.length > 0 ? 'discard' : 'robber';
        for (const color of colors) {
          log(`${color} must discard ${discards[color]} cards`);
          const sid = socketIdForColor(room, color);
          if (sid) io.to(sid).emit('must_discard', { count: discards[color] });
        }
      } else {
        result.log.forEach(log);
        board.gameState.turnPhase = 'build';
      }

      broadcast(socket.roomCode);
      break;
    }

    case 'place_settlement': {
      const { vertex } = action;
      if (typeof vertex !== 'number') return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded)  return actionError(socket, 'game has ended');
      const isOpening = board.gameState.phase === 'opening';
      if (!isOpening && board.gameState.turnPhase === 'roll') return actionError(socket, 'roll dice before building');
      if (!isOpening) {
        const block = robberBlockReason(board);
        if (block) return actionError(socket, block);
      }

      const place = Board.canPlaceSettlement(board, vertex, myColor);
      if (!place.valid) return actionError(socket, place.reason);
      if (Board.piecesLeft(board, myColor, 'settlement') < 1) return actionError(socket, 'no settlements left');

      if (!isOpening) {
        const afford = Board.canAfford(board, myColor, 'settlement');
        if (!afford.valid) return actionError(socket, afford.reason);
      }

      board.pieces.settlements[vertex] = myColor;
      Board.payCost(board, myColor, 'settlement');
      log(`${myColor} placed a Settlement`);

      if (isOpening) {
        board.gameState.lastSettlementVertex = vertex;
        const half = board.gameState.openingOrder.length / 2;
        if (board.gameState.openingTurn >= half) {
          const before = { ...board.players[myColor] };
          Board.giveStartingResources(board, vertex, myColor);
          const got = Board.RESOURCES
            .filter(r => board.players[myColor][r] > before[r])
            .map(r => `${board.players[myColor][r] - before[r]} ${r}`);
          if (got.length) log(`${myColor} got ${got.join(', ')}`);
        }
        Board.advanceOpening(board);
      }

      logIfWon();
      broadcast(socket.roomCode);
      break;
    }

    case 'place_city': {
      const { vertex } = action;
      if (typeof vertex !== 'number') return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded)  return actionError(socket, 'game has ended');
      if (board.gameState.phase === 'opening')   return actionError(socket, 'no cities during opening');
      if (board.gameState.turnPhase === 'roll')  return actionError(socket, 'roll dice before building');
      { const block = robberBlockReason(board); if (block) return actionError(socket, block); }

      const place = Board.canUpgradeToCity(board, vertex, myColor);
      if (!place.valid) return actionError(socket, place.reason);
      if (Board.piecesLeft(board, myColor, 'city') < 1) return actionError(socket, 'no cities left');

      const afford = Board.canAfford(board, myColor, 'city');
      if (!afford.valid) return actionError(socket, afford.reason);

      delete board.pieces.settlements[vertex];
      board.pieces.cities[vertex] = myColor;
      Board.payCost(board, myColor, 'city');
      log(`${myColor} built a City`);

      logIfWon();
      broadcast(socket.roomCode);
      break;
    }

    case 'place_road': {
      const { edge } = action;
      if (typeof edge !== 'number') return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded) return actionError(socket, 'game has ended');
      const isOpening = board.gameState.phase === 'opening';
      if (!isOpening && board.gameState.turnPhase === 'roll') return actionError(socket, 'roll dice before building');
      if (!isOpening) {
        const block = robberBlockReason(board);
        if (block) return actionError(socket, block);
      }

      const place = Board.canPlaceRoad(board, edge, myColor);
      if (!place.valid) return actionError(socket, place.reason);
      if (Board.piecesLeft(board, myColor, 'road') < 1) return actionError(socket, 'no roads left');

      if (!isOpening) {
        const afford = Board.canAfford(board, myColor, 'road');
        if (!afford.valid) return actionError(socket, afford.reason);
      }

      board.pieces.roads[edge] = myColor;
      Board.payCost(board, myColor, 'road');
      log(`${myColor} placed a Road`);

      if (isOpening) {
        Board.advanceOpening(board);
        if (board.gameState.openingStep === 'settlement') log('---');
      }
      broadcast(socket.roomCode);
      break;
    }

    case 'end_turn': {
      if (board.gameState.phase !== 'main')      return actionError(socket, 'not in main phase');
      if (board.gameState.turnPhase !== 'build') return actionError(socket, 'must roll dice before ending turn');
      board.lastRoll = null;
      Board.endTurn(board);
      log('---');
      broadcast(socket.roomCode);
      break;
    }

    case 'trade_with_bank': {
      const { giveResource, getResource } = action;
      if (!giveResource || !getResource)         return actionError(socket, 'invalid action params');
      if (board.gameState.phase !== 'main')      return actionError(socket, 'not in main phase');
      if (board.gameState.turnPhase !== 'build') return actionError(socket, 'roll dice before trading');

      const result = Board.tradeWithBank(board, myColor, giveResource, getResource);
      if (!result.valid) return actionError(socket, result.reason);

      log(`${myColor} gave bank ${result.rate} ${giveResource} and took 1 ${getResource}`);
      broadcast(socket.roomCode);
      break;
    }

    case 'move_robber': {
      const { tileIndex, victim } = action;
      if (typeof tileIndex !== 'number') return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded)     return actionError(socket, 'game has ended');
      if (board.gameState.turnPhase !== 'robber') return actionError(socket, 'not time to move the robber');
      if (myColor !== Board.getCurrentPlayer(board)) return actionError(socket, "it's not your turn");

      const result = Board.moveRobber(board, tileIndex, myColor, victim);
      if (!result.valid) return actionError(socket, result.reason);

      log(result.victim
        ? `${myColor} moved the robber and stole a card from ${result.victim}`
        : `${myColor} moved the robber`);
      broadcast(socket.roomCode);
      break;
    }

    case 'discard_resources': {
      if (board.gameState.turnPhase !== 'discard') return actionError(socket, 'no discard pending');
      const { resources } = action;
      if (!resources || typeof resources !== 'object') return actionError(socket, 'invalid action params');

      const result = Board.discardResources(board, myColor, resources);
      if (!result.valid) return actionError(socket, result.reason);

      const total = Object.values(resources).reduce((s, n) => s + n, 0);
      log(`${myColor} discarded ${total} cards`);
      broadcast(socket.roomCode);
      break;
    }

    case 'regenerate': {
      if (myColor !== room.hostColor) return actionError(socket, 'only the host can regenerate the board');
      room.board     = freshBoard(room, action.balanced);
      room.rollLog   = [];
      room.winLogged = false;
      broadcast(socket.roomCode);
      break;
    }

    case 'clear_pieces': {
      if (myColor !== room.hostColor) return actionError(socket, 'only the host can clear pieces');
      board.pieces  = { settlements: {}, cities: {}, roads: {} };
      const colors  = connectedColors(room);
      board.players = {};
      for (const c of colors) board.players[c] = { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 };
      board.gameState.winner          = null;
      board.gameState.gameEnded       = false;
      board.gameState.pendingDiscards = {};
      board.gameState.stats           = { startedAt: Date.now(), endedAt: null, turns: 0, rolls: {}, gained: {} };
      room.winLogged                  = false;
      if (board.gameState.turnPhase === 'discard' || board.gameState.turnPhase === 'robber') {
        board.gameState.turnPhase = 'build';
      }
      board.lastRoll            = null;
      broadcast(socket.roomCode);
      break;
    }

    default:
      actionError(socket, `unknown action type: ${action.type}`);
  }
}

// ── Socket.io ────────────────────────────────────────────────────────────────
app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log(`client connected    [${socket.id}]`);

  // Puts this socket in the given seat. If the seat was open in another tab,
  // that tab is told and dropped, so one seat never has two sockets.
  function takeSeat(code, token, player, isRejoin) {
    const room    = rooms[code];
    const old     = player.socketId && player.socketId !== socket.id && io.sockets.sockets.get(player.socketId);
    const wasAway = !player.connected;
    player.socketId  = socket.id;
    player.connected = true;
    if (old) {
      old.emit('session_moved');
      old.roomCode = null;
      old.disconnect(true);
    }

    socket.roomCode    = code;
    socket.playerColor = player.color;
    socket.join(code);
    cancelCleanup(code);

    socket.emit('room_joined', {
      roomCode:    code,
      playerColor: player.color,
      isHost:      player.color === room.hostColor,
      players:     playersPayload(room),
      hostColor:   room.hostColor,
    });
    broadcastPlayersUpdate(code);
    if (room.started) {
      if (isRejoin && wasAway) addLog(room, `${player.color} is back`);
      broadcast(code);
    }
  }

  socket.on('create_room', (payload = {}) => {
    const token = validToken(payload.token) ? payload.token : socket.id;
    const code  = genCode();
    const color = 'red';
    rooms[code] = {
      board:        null,
      rollLog:      [],
      players:      { [token]: { color, connected: true, socketId: socket.id } },
      hostSocketId: socket.id,
      hostColor:    color,
      started:      false,
      cleanupTimer: null,
      winTarget:    10,
    };
    takeSeat(code, token, rooms[code].players[token], false);
  });

  socket.on('join_room', (payload = {}) => {
    const code  = String(payload.roomCode || '').toUpperCase().trim();
    const token = validToken(payload.token) ? payload.token : socket.id;
    const room  = rooms[code];
    if (!room) return socket.emit('room_error', { reason: `Room "${code}" not found`, notFound: true });

    // Same tab coming back (refresh, lost connection): give the seat back
    const mine = room.players[token];
    if (mine) return takeSeat(code, token, mine, room.started);

    if (room.started) {
      // Lost their key (closed the tab): let them pick an empty seat
      const free = Object.entries(room.players).filter(([, p]) => !p.connected);
      const wanted = free.find(([, p]) => p.color === payload.takeSeat);
      if (wanted) {
        const [oldToken, player] = wanted;
        delete room.players[oldToken];
        room.players[token] = player;
        return takeSeat(code, token, player, true);
      }
      if (free.length) return socket.emit('seat_choice', { roomCode: code, seats: free.map(([, p]) => p.color) });
      return socket.emit('room_error', { reason: 'Game already in progress' });
    }

    const color = nextColor(room);
    if (!color) return socket.emit('room_error', { reason: 'Room is full (4 players max)' });
    room.players[token] = { color, connected: true, socketId: socket.id };
    takeSeat(code, token, room.players[token], false);
  });

  socket.on('start_game', (payload = {}) => {
    const room = getRoom(socket);
    if (!room)                                 return socket.emit('room_error', { reason: 'Not in a room' });
    if (socket.playerColor !== room.hostColor) return socket.emit('room_error', { reason: 'Only the host can start the game' });
    const colors = connectedColors(room);
    if (colors.length < 2)                     return socket.emit('room_error', { reason: 'Need at least 2 players to start' });

    const t = parseInt(payload.winTarget, 10);
    room.winTarget = [3,5,8,10].includes(t) ? t : 10;
    room.mapId     = Board.MAPS[payload.mapId] ? payload.mapId : Board.DEFAULT_MAP;

    room.board     = freshBoard(room, false);
    room.rollLog   = [];
    room.started   = true;
    room.winLogged = false;
    broadcast(socket.roomCode);
  });

  socket.on('chat', (payload = {}) => {
    const room = getRoom(socket);
    if (!room || !socket.playerColor) return;
    const text = String(payload.text || '').trim().slice(0, 200);
    if (!text) return;
    const now = Date.now();
    if (socket.lastChatAt && now - socket.lastChatAt < 400) return; // simple flood guard
    socket.lastChatAt = now;
    io.to(socket.roomCode).emit('chat', { color: socket.playerColor, text });
  });

  socket.on('action', (action) => {
    try {
      handleAction(socket, action);
    } catch (err) {
      console.error('unhandled action error:', err);
      actionError(socket, 'internal server error');
    }
  });

  socket.on('disconnect', () => {
    console.log(`client disconnected [${socket.id}]`);
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;

    // Only the socket currently holding the seat counts (an old tab may close later)
    const player = Object.values(room.players).find(p => p.socketId === socket.id);
    if (!player) return;
    player.connected = false;

    if (player.color === room.hostColor) {
      const newHost = Object.values(room.players).find(p => p.connected);
      if (newHost) {
        room.hostSocketId = newHost.socketId;
        room.hostColor    = newHost.color;
        io.to(newHost.socketId).emit('promoted_host');
      }
    }

    broadcastPlayersUpdate(code);
    if (room.started) {
      addLog(room, `${player.color} lost connection`);
      broadcast(code);
    }

    const anyConnected = Object.values(room.players).some(p => p.connected);
    if (!anyConnected) scheduleCleanup(code);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
