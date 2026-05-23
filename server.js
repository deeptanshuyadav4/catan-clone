'use strict';
const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const Board   = require('./public/board-core.js');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = 3000;

// ── Source of truth ─────────────────────────────────────────────────────────
let board   = Board.generateBoard();
let rollLog = [];

function broadcast() {
  io.emit('state', { board, rollLog });
}

function actionError(socket, reason) {
  socket.emit('action_error', { reason });
}

// Used by Balanced button
function isBalanced(b) {
  for (let i = 0; i < b.tiles.length; i++) {
    if (b.numbers[i] !== 6 && b.numbers[i] !== 8) continue;
    for (const n of Board.getNeighbors(i, b.positions)) {
      if (b.numbers[n] === 6 || b.numbers[n] === 8) return false;
    }
  }
  return true;
}

// ── Action handler ───────────────────────────────────────────────────────────
function handleAction(socket, action) {
  switch (action.type) {

    case 'roll_dice': {
      if (board.gameState.phase !== 'main')          return actionError(socket, 'not in main phase');
      if (board.gameState.turnPhase !== 'roll')       return actionError(socket, 'already rolled this turn');
      const roll   = Board.rollDice();
      const result = Board.distributeResources(board, roll.total);
      board.gameState.turnPhase  = 'build';
      board.gameState.diceRolled = true;
      board.lastRoll = roll;
      rollLog.unshift(result.log);
      if (rollLog.length > 50) rollLog.pop();
      broadcast();
      break;
    }

    case 'place_settlement': {
      const { vertex, playerId } = action;
      if (typeof vertex !== 'number' || !playerId) return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded)                return actionError(socket, 'game has ended');
      const isOpening = board.gameState.phase === 'opening';
      if (!isOpening && board.gameState.turnPhase === 'roll') return actionError(socket, 'roll dice before building');

      const place = Board.canPlaceSettlement(board, vertex, playerId);
      if (!place.valid) return actionError(socket, place.reason);

      if (!isOpening) {
        const afford = Board.canAfford(board, playerId, 'settlement');
        if (!afford.valid) return actionError(socket, afford.reason);
      }

      board.pieces.settlements[vertex] = playerId;
      Board.payCost(board, playerId, 'settlement');

      if (isOpening) {
        board.gameState.lastSettlementVertex = vertex;
        if (board.gameState.openingTurn >= 4) Board.giveStartingResources(board, vertex, playerId);
        Board.advanceOpening(board);
      }

      Board.checkWinner(board);
      broadcast();
      break;
    }

    case 'place_city': {
      const { vertex, playerId } = action;
      if (typeof vertex !== 'number' || !playerId) return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded)               return actionError(socket, 'game has ended');
      if (board.gameState.phase === 'opening')     return actionError(socket, 'no cities during opening');
      if (board.gameState.turnPhase === 'roll')    return actionError(socket, 'roll dice before building');

      const place = Board.canUpgradeToCity(board, vertex, playerId);
      if (!place.valid) return actionError(socket, place.reason);

      const afford = Board.canAfford(board, playerId, 'city');
      if (!afford.valid) return actionError(socket, afford.reason);

      delete board.pieces.settlements[vertex];
      board.pieces.cities[vertex] = playerId;
      Board.payCost(board, playerId, 'city');

      Board.checkWinner(board);
      broadcast();
      break;
    }

    case 'place_road': {
      const { edge, playerId } = action;
      if (typeof edge !== 'number' || !playerId) return actionError(socket, 'invalid action params');
      if (board.gameState.gameEnded)             return actionError(socket, 'game has ended');
      const isOpening = board.gameState.phase === 'opening';
      if (!isOpening && board.gameState.turnPhase === 'roll') return actionError(socket, 'roll dice before building');

      const place = Board.canPlaceRoad(board, edge, playerId);
      if (!place.valid) return actionError(socket, place.reason);

      if (!isOpening) {
        const afford = Board.canAfford(board, playerId, 'road');
        if (!afford.valid) return actionError(socket, afford.reason);
      }

      board.pieces.roads[edge] = playerId;
      Board.payCost(board, playerId, 'road');

      if (isOpening) Board.advanceOpening(board);
      broadcast();
      break;
    }

    case 'end_turn': {
      if (board.gameState.phase !== 'main')      return actionError(socket, 'not in main phase');
      if (board.gameState.turnPhase !== 'build') return actionError(socket, 'must roll dice before ending turn');
      board.lastRoll = null;
      Board.endTurn(board);
      broadcast();
      break;
    }

    case 'trade_with_bank': {
      const { playerId, giveResource, getResource } = action;
      if (!playerId || !giveResource || !getResource) return actionError(socket, 'invalid action params');
      if (board.gameState.phase !== 'main')            return actionError(socket, 'not in main phase');
      if (board.gameState.turnPhase !== 'build')       return actionError(socket, 'roll dice before trading');

      const result = Board.tradeWithBank(board, playerId, giveResource, getResource);
      if (!result.valid) return actionError(socket, result.reason);

      rollLog.unshift(`${playerId} traded ${result.rate} ${giveResource} → 1 ${getResource}`);
      if (rollLog.length > 50) rollLog.pop();
      broadcast();
      break;
    }

    case 'move_robber': {
      const { tileIndex } = action;
      if (typeof tileIndex !== 'number') return actionError(socket, 'invalid action params');
      board.robber = tileIndex;
      broadcast();
      break;
    }

    case 'regenerate': {
      if (action.balanced) {
        let b = Board.generateBoard();
        for (let attempt = 0; attempt < 199; attempt++) {
          if (isBalanced(b)) break;
          b = Board.generateBoard();
        }
        board = b;
      } else {
        board = Board.generateBoard();
      }
      rollLog = [];
      broadcast();
      break;
    }

    case 'clear_pieces': {
      board.pieces = { settlements: {}, cities: {}, roads: {} };
      board.players = {
        red:    { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
        blue:   { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
        white:  { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
        orange: { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
      };
      board.gameState.winner    = null;
      board.gameState.gameEnded = false;
      board.lastRoll = null;
      broadcast();
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
  socket.emit('state', { board, rollLog });

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
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
