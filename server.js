'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const Board   = require('./public/board-core.js');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = 3000;

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
  io.to(roomCode).emit('state', { board: room.board, rollLog: room.rollLog });
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

function isBalanced(b) {
  for (let i = 0; i < b.tiles.length; i++) {
    if (b.numbers[i] !== 6 && b.numbers[i] !== 8) continue;
    for (const n of Board.getNeighbors(i, b.positions)) {
      if (b.numbers[n] === 6 || b.numbers[n] === 8) return false;
    }
  }
  return true;
}

function freshBoard(room, balanced) {
  let b;
  if (balanced) {
    b = Board.generateBoard();
    for (let attempt = 0; attempt < 199; attempt++) {
      if (isBalanced(b)) break;
      b = Board.generateBoard();
    }
  } else {
    b = Board.generateBoard();
  }
  const colors = connectedColors(room);
  b.gameState.playerOrder        = colors;
  b.gameState.openingOrder       = buildOpeningOrder(colors);
  b.gameState.openingTurn        = 0;
  b.gameState.currentPlayerIndex = 0;
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

  const { rollLog } = room;
  let { board }     = room;
  const myColor     = socket.playerColor;

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
      board.gameState.turnPhase  = 'build';
      board.gameState.diceRolled = true;
      board.lastRoll = roll;
      rollLog.unshift(result.log);
      if (rollLog.length > 50) rollLog.pop();
      broadcast(socket.roomCode);
      break;
    }

    case 'place_settlement': {
      const { vertex } = action;
      if (typeof vertex !== 'number') return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded)  return actionError(socket, 'game has ended');
      const isOpening = board.gameState.phase === 'opening';
      if (!isOpening && board.gameState.turnPhase === 'roll') return actionError(socket, 'roll dice before building');

      const place = Board.canPlaceSettlement(board, vertex, myColor);
      if (!place.valid) return actionError(socket, place.reason);

      if (!isOpening) {
        const afford = Board.canAfford(board, myColor, 'settlement');
        if (!afford.valid) return actionError(socket, afford.reason);
      }

      board.pieces.settlements[vertex] = myColor;
      Board.payCost(board, myColor, 'settlement');

      if (isOpening) {
        board.gameState.lastSettlementVertex = vertex;
        const half = board.gameState.openingOrder.length / 2;
        if (board.gameState.openingTurn >= half) Board.giveStartingResources(board, vertex, myColor);
        Board.advanceOpening(board);
      }

      Board.checkWinner(board);
      broadcast(socket.roomCode);
      break;
    }

    case 'place_city': {
      const { vertex } = action;
      if (typeof vertex !== 'number') return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded)  return actionError(socket, 'game has ended');
      if (board.gameState.phase === 'opening')   return actionError(socket, 'no cities during opening');
      if (board.gameState.turnPhase === 'roll')  return actionError(socket, 'roll dice before building');

      const place = Board.canUpgradeToCity(board, vertex, myColor);
      if (!place.valid) return actionError(socket, place.reason);

      const afford = Board.canAfford(board, myColor, 'city');
      if (!afford.valid) return actionError(socket, afford.reason);

      delete board.pieces.settlements[vertex];
      board.pieces.cities[vertex] = myColor;
      Board.payCost(board, myColor, 'city');

      Board.checkWinner(board);
      broadcast(socket.roomCode);
      break;
    }

    case 'place_road': {
      const { edge } = action;
      if (typeof edge !== 'number') return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded) return actionError(socket, 'game has ended');
      const isOpening = board.gameState.phase === 'opening';
      if (!isOpening && board.gameState.turnPhase === 'roll') return actionError(socket, 'roll dice before building');

      const place = Board.canPlaceRoad(board, edge, myColor);
      if (!place.valid) return actionError(socket, place.reason);

      if (!isOpening) {
        const afford = Board.canAfford(board, myColor, 'road');
        if (!afford.valid) return actionError(socket, afford.reason);
      }

      board.pieces.roads[edge] = myColor;
      Board.payCost(board, myColor, 'road');

      if (isOpening) Board.advanceOpening(board);
      broadcast(socket.roomCode);
      break;
    }

    case 'end_turn': {
      if (board.gameState.phase !== 'main')      return actionError(socket, 'not in main phase');
      if (board.gameState.turnPhase !== 'build') return actionError(socket, 'must roll dice before ending turn');
      board.lastRoll = null;
      Board.endTurn(board);
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

      rollLog.unshift(`${myColor} traded ${result.rate} ${giveResource} → 1 ${getResource}`);
      if (rollLog.length > 50) rollLog.pop();
      broadcast(socket.roomCode);
      break;
    }

    case 'move_robber': {
      const { tileIndex } = action;
      if (typeof tileIndex !== 'number') return actionError(socket, 'invalid action params');
      board.robber = tileIndex;
      broadcast(socket.roomCode);
      break;
    }

    case 'regenerate': {
      if (myColor !== room.hostColor) return actionError(socket, 'only the host can regenerate the board');
      room.board   = freshBoard(room, action.balanced);
      room.rollLog = [];
      broadcast(socket.roomCode);
      break;
    }

    case 'clear_pieces': {
      if (myColor !== room.hostColor) return actionError(socket, 'only the host can clear pieces');
      board.pieces  = { settlements: {}, cities: {}, roads: {} };
      const colors  = connectedColors(room);
      board.players = {};
      for (const c of colors) board.players[c] = { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 };
      board.gameState.winner    = null;
      board.gameState.gameEnded = false;
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

  socket.on('create_room', () => {
    const code  = genCode();
    const color = 'red';
    rooms[code] = {
      board:        null,
      rollLog:      [],
      players:      { [socket.id]: { color, connected: true } },
      hostSocketId: socket.id,
      hostColor:    color,
      started:      false,
      cleanupTimer: null,
    };
    socket.roomCode    = code;
    socket.playerColor = color;
    socket.join(code);
    socket.emit('room_joined', {
      roomCode:    code,
      playerColor: color,
      isHost:      true,
      players:     playersPayload(rooms[code]),
      hostColor:   color,
    });
  });

  socket.on('join_room', ({ roomCode }) => {
    const code = (roomCode || '').toUpperCase().trim();
    const room = rooms[code];
    if (!room)        return socket.emit('room_error', { reason: `Room "${code}" not found` });
    if (room.started) return socket.emit('room_error', { reason: 'Game already in progress' });
    const color = nextColor(room);
    if (!color)       return socket.emit('room_error', { reason: 'Room is full (4 players max)' });

    room.players[socket.id] = { color, connected: true };
    socket.roomCode    = code;
    socket.playerColor = color;
    socket.join(code);
    socket.emit('room_joined', {
      roomCode:    code,
      playerColor: color,
      isHost:      false,
      players:     playersPayload(room),
      hostColor:   room.hostColor,
    });
    broadcastPlayersUpdate(code);
  });

  socket.on('start_game', () => {
    const room = getRoom(socket);
    if (!room)                                 return socket.emit('room_error', { reason: 'Not in a room' });
    if (socket.playerColor !== room.hostColor) return socket.emit('room_error', { reason: 'Only the host can start the game' });
    const colors = connectedColors(room);
    if (colors.length < 2)                     return socket.emit('room_error', { reason: 'Need at least 2 players to start' });

    room.board   = freshBoard(room, false);
    room.rollLog = [];
    room.started = true;
    broadcast(socket.roomCode);
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

    if (room.players[socket.id]) room.players[socket.id].connected = false;

    if (socket.playerColor === room.hostColor) {
      const newHostEntry = Object.entries(room.players).find(([, p]) => p.connected);
      if (newHostEntry) {
        const [newHostId, newHostPlayer] = newHostEntry;
        room.hostSocketId = newHostId;
        room.hostColor    = newHostPlayer.color;
        io.to(newHostId).emit('promoted_host');
      }
    }

    broadcastPlayersUpdate(code);

    const anyConnected = Object.values(room.players).some(p => p.connected);
    if (!anyConnected) scheduleCleanup(code);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
