'use strict';
// board-core.js — Pure game logic.
// Works as a Node.js require() module (server) AND a browser <script> tag (client).

const HEX_SIZE   = 50;
const HEX_WIDTH  = Math.sqrt(3) * HEX_SIZE;
const ROW_HEIGHT = 1.5 * HEX_SIZE;
const ROW_COUNTS = [4, 5, 6, 7, 6, 5, 4];
const CENTER_X   = 400;
const CENTER_Y   = 400;

const TILE_RESOURCE = {
  forest: 'wood', hills: 'brick', fields: 'wheat', pasture: 'wool', mountains: 'ore', desert: null,
};

const BUILD_COSTS = {
  road:       { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, wool: 1 },
  city:       { wheat: 2, ore: 3 },
};

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generatePorts(graph, rng) {
  const coastal = graph.edges
    .map((e, i) => ({ ...e, idx: i }))
    .filter(e => e.tiles.length === 1);

  coastal.sort((a, b) => {
    const ax = Math.atan2((a.y1 + a.y2) / 2 - CENTER_Y, (a.x1 + a.x2) / 2 - CENTER_X);
    const bx = Math.atan2((b.y1 + b.y2) / 2 - CENTER_Y, (b.x1 + b.x2) / 2 - CENTER_X);
    return ax - bx;
  });

  const n = coastal.length;
  const chosen = [];
  for (let i = 0; i < 9; i++) chosen.push(coastal[Math.round(i * n / 9) % n]);

  const portTypes = shuffle(
    ['any', 'any', 'any', 'any', 'wood', 'brick', 'wheat', 'wool', 'ore'],
    rng
  );

  return chosen.map((edge, i) => {
    const mx   = (edge.x1 + edge.x2) / 2;
    const my   = (edge.y1 + edge.y2) / 2;
    const dx   = mx - CENTER_X;
    const dy   = my - CENTER_Y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const type = portTypes[i];
    return {
      edgeIdx: edge.idx,
      type,
      rate:    type === 'any' ? 3 : 2,
      iconX:   Math.round(mx + (dx / dist) * 26),
      iconY:   Math.round(my + (dy / dist) * 26),
      vertexA: edge.vertexA,
      vertexB: edge.vertexB,
    };
  });
}

function generatePositions() {
  const positions = [];
  for (let row = 0; row < ROW_COUNTS.length; row++) {
    const count = ROW_COUNTS[row];
    const y = CENTER_Y + (row - 3) * ROW_HEIGHT;
    for (let col = 0; col < count; col++) {
      const x = CENTER_X + (col - (count - 1) / 2) * HEX_WIDTH;
      positions.push({ x, y, row, col });
    }
  }
  return positions;
}

function generateBoard(seed) {
  if (seed === undefined) seed = Math.floor(Math.random() * 0xFFFFFFFF);
  const rng = mulberry32(seed);

  const positions = generatePositions();

  const tilePool = [
    ...Array(8).fill('forest'),
    ...Array(8).fill('pasture'),
    ...Array(7).fill('fields'),
    ...Array(6).fill('hills'),
    ...Array(6).fill('mountains'),
    ...Array(2).fill('desert'),
  ];
  const tiles = shuffle([...tilePool], rng);

  const numberPool = [
    2,
    3, 3, 3,
    4, 4, 4, 4, 4,
    5, 5, 5, 5,
    6, 6, 6, 6,
    8, 8, 8, 8,
    9, 9, 9, 9, 9,
    10, 10, 10, 10, 10,
    11, 11, 11,
    12,
  ];
  const shuffledNumbers = shuffle([...numberPool], rng);

  const numbers = {};
  let numIdx = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== 'desert') numbers[i] = shuffledNumbers[numIdx++];
  }

  const robber = tiles.indexOf('desert');
  return { positions, tiles, numbers, robber, seed };
}

function getNeighbors(idx, positions) {
  const threshold = HEX_WIDTH * 1.1;
  const { x, y } = positions[idx];
  const neighbors = [];
  for (let i = 0; i < positions.length; i++) {
    if (i === idx) continue;
    const dx = positions[i].x - x;
    const dy = positions[i].y - y;
    if (Math.sqrt(dx * dx + dy * dy) < threshold) neighbors.push(i);
  }
  return neighbors;
}

function computeGraph(positions) {
  const vertexMap      = new Map();
  const vertices       = [];
  const edgeMap        = new Map();
  const edges          = [];
  const vertexAdjacency = {};
  const vertexEdges     = {};

  function getOrAddVertex(px, py, tileIdx) {
    const key = `${px.toFixed(2)},${py.toFixed(2)}`;
    if (!vertexMap.has(key)) {
      vertexMap.set(key, vertices.length);
      vertices.push({ x: px, y: py, tiles: [] });
    }
    const vIdx = vertexMap.get(key);
    if (!vertices[vIdx].tiles.includes(tileIdx)) vertices[vIdx].tiles.push(tileIdx);
    return vIdx;
  }

  for (let tileIdx = 0; tileIdx < positions.length; tileIdx++) {
    const { x: cx, y: cy } = positions[tileIdx];
    const corners = [];
    for (let i = 0; i < 6; i++) {
      const rad = (Math.PI / 180) * (60 * i + 30);
      corners.push(getOrAddVertex(cx + HEX_SIZE * Math.cos(rad), cy + HEX_SIZE * Math.sin(rad), tileIdx));
    }

    for (let i = 0; i < 6; i++) {
      const vA   = corners[i];
      const vB   = corners[(i + 1) % 6];
      const eKey = `${Math.min(vA, vB)}-${Math.max(vA, vB)}`;

      if (!edgeMap.has(eKey)) {
        const eIdx = edges.length;
        edgeMap.set(eKey, eIdx);
        edges.push({
          x1: vertices[vA].x, y1: vertices[vA].y,
          x2: vertices[vB].x, y2: vertices[vB].y,
          vertexA: vA, vertexB: vB,
          tiles: [],
        });
        if (!vertexAdjacency[vA]) vertexAdjacency[vA] = [];
        if (!vertexAdjacency[vB]) vertexAdjacency[vB] = [];
        if (!vertexEdges[vA])     vertexEdges[vA]     = [];
        if (!vertexEdges[vB])     vertexEdges[vB]     = [];
        vertexAdjacency[vA].push(vB);
        vertexAdjacency[vB].push(vA);
        vertexEdges[vA].push(eIdx);
        vertexEdges[vB].push(eIdx);
      }

      const eIdx = edgeMap.get(eKey);
      if (!edges[eIdx].tiles.includes(tileIdx)) edges[eIdx].tiles.push(tileIdx);
    }
  }

  return { vertices, edges, vertexAdjacency, vertexEdges };
}

const _generateBoard = generateBoard;
function generateBoardWithGraph(seed) {
  const board  = _generateBoard(seed);
  board.graph  = computeGraph(board.positions);
  board.ports  = generatePorts(board.graph, mulberry32(board.seed ^ 0x9E3779B9));
  board.pieces = { settlements: {}, cities: {}, roads: {} };
  board.players = {
    red:    { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
    blue:   { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
    white:  { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
    orange: { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
  };
  board.gameState = {
    phase:                'opening',
    openingTurn:          0,
    openingOrder:         ['red', 'blue', 'white', 'orange', 'orange', 'white', 'blue', 'red'],
    openingStep:          'settlement',
    lastSettlementVertex: null,
    currentPlayerIndex:   0,
    playerOrder:          ['red', 'blue', 'white', 'orange'],
    turnPhase:            'roll',
    diceRolled:           false,
    winner:               null,
    gameEnded:            false,
  };
  board.lastRoll = null;
  return board;
}

function canPlaceSettlement(board, vertexIdx, playerId) {
  const { settlements, cities, roads } = board.pieces;
  if (settlements[vertexIdx] || cities[vertexIdx]) return { valid: false, reason: 'spot is taken' };
  for (const adjV of (board.graph.vertexAdjacency[vertexIdx] || [])) {
    if (settlements[adjV] || cities[adjV]) return { valid: false, reason: 'too close to another settlement' };
  }
  if (board.gameState.phase !== 'opening') {
    const hasRoad = (board.graph.vertexEdges[vertexIdx] || []).some(eIdx => roads[eIdx] === playerId);
    if (!hasRoad) return { valid: false, reason: 'settlement must connect to your road' };
  }
  return { valid: true, reason: '' };
}

function canPlaceRoad(board, edgeIdx, playerId) {
  const { roads, settlements, cities } = board.pieces;
  if (roads[edgeIdx]) return { valid: false, reason: 'road already exists' };
  const edge = board.graph.edges[edgeIdx];
  if (board.gameState.phase === 'opening') {
    const lastV = board.gameState.lastSettlementVertex;
    if (edge.vertexA !== lastV && edge.vertexB !== lastV) {
      return { valid: false, reason: 'road must touch the settlement you just placed' };
    }
    return { valid: true, reason: '' };
  }
  for (const vIdx of [edge.vertexA, edge.vertexB]) {
    if (settlements[vIdx] === playerId || cities[vIdx] === playerId) return { valid: true, reason: '' };
    for (const adjEdgeIdx of (board.graph.vertexEdges[vIdx] || [])) {
      if (adjEdgeIdx !== edgeIdx && roads[adjEdgeIdx] === playerId) return { valid: true, reason: '' };
    }
  }
  return { valid: false, reason: 'road must connect to your settlement or another road' };
}

function canUpgradeToCity(board, vertexIdx, playerId) {
  const { settlements, cities } = board.pieces;
  if (cities[vertexIdx]) return { valid: false, reason: 'already a city' };
  if (settlements[vertexIdx] !== playerId) return { valid: false, reason: "you don't have a settlement here" };
  return { valid: true, reason: '' };
}

function rollDice() {
  const d1 = Math.floor(Math.random() * 6) + 1;
  const d2 = Math.floor(Math.random() * 6) + 1;
  return { d1, d2, total: d1 + d2 };
}

function distributeResources(board, rolledNumber) {
  if (rolledNumber === 7) {
    return { type: 'robber', log: 'Rolled 7 — robber mechanics not implemented yet' };
  }

  const producingTiles = new Set();
  for (let idx = 0; idx < board.tiles.length; idx++) {
    if (board.numbers[idx] === rolledNumber && idx !== board.robber) producingTiles.add(idx);
  }

  const distribution = {};
  board.graph.vertices.forEach((vertex, vIdx) => {
    if (!vertex.tiles.some(t => producingTiles.has(t))) return;
    const playerId = board.pieces.settlements[vIdx] || board.pieces.cities[vIdx] || null;
    if (!playerId) return;
    const amount = board.pieces.cities[vIdx] ? 2 : 1;
    vertex.tiles.forEach(tileIdx => {
      if (!producingTiles.has(tileIdx)) return;
      const resource = TILE_RESOURCE[board.tiles[tileIdx]];
      if (!resource) return;
      if (!distribution[playerId]) distribution[playerId] = {};
      distribution[playerId][resource] = (distribution[playerId][resource] || 0) + amount;
      board.players[playerId][resource] += amount;
    });
  });

  const playerParts = Object.entries(distribution).map(([pid, res]) => {
    const resList = Object.entries(res).map(([r, a]) => `${a} ${r}`).join(', ');
    return `${pid} got ${resList}`;
  });

  const log = playerParts.length > 0
    ? `Rolled ${rolledNumber} — ${playerParts.join(' · ')}`
    : `Rolled ${rolledNumber} — nobody collected anything`;

  return { type: 'distribute', rolledNumber, distribution, log };
}

function getCurrentPlayer(board) {
  if (board.gameState.phase === 'opening') {
    return board.gameState.openingOrder[board.gameState.openingTurn];
  }
  return board.gameState.playerOrder[board.gameState.currentPlayerIndex];
}

function endTurn(board) {
  const gs = board.gameState;
  gs.currentPlayerIndex = (gs.currentPlayerIndex + 1) % gs.playerOrder.length;
  gs.diceRolled = false;
  gs.turnPhase  = 'roll';
}

function advanceOpening(board) {
  const gs = board.gameState;
  if (gs.openingStep === 'settlement') {
    gs.openingStep = 'road';
  } else {
    gs.openingStep = 'settlement';
    gs.openingTurn++;
    if (gs.openingTurn > 7) {
      gs.phase              = 'main';
      gs.currentPlayerIndex = 0;
      gs.turnPhase          = 'roll';
    }
  }
}

function giveStartingResources(board, vertexIdx, playerId) {
  board.graph.vertices[vertexIdx].tiles.forEach(tileIdx => {
    const resource = TILE_RESOURCE[board.tiles[tileIdx]];
    if (resource) board.players[playerId][resource] += 1;
  });
}

function canAfford(board, playerId, buildingType) {
  if (board.gameState.phase === 'opening') return { valid: true, reason: '' };
  const cost = BUILD_COSTS[buildingType];
  if (!cost) return { valid: true, reason: '' };
  const res = board.players[playerId];
  const missing = [];
  for (const [r, amount] of Object.entries(cost)) {
    const shortfall = amount - (res[r] || 0);
    if (shortfall > 0) missing.push(`${shortfall} ${r}`);
  }
  return missing.length > 0
    ? { valid: false, reason: `not enough resources — need ${missing.join(', ')}` }
    : { valid: true, reason: '' };
}

function payCost(board, playerId, buildingType) {
  if (board.gameState.phase === 'opening') return;
  const cost = BUILD_COSTS[buildingType];
  if (!cost) return;
  const res = board.players[playerId];
  for (const [r, amount] of Object.entries(cost)) res[r] = (res[r] || 0) - amount;
}

function calculateVP(board, playerId) {
  let vp = 0;
  for (const pid of Object.values(board.pieces.settlements)) if (pid === playerId) vp += 1;
  for (const pid of Object.values(board.pieces.cities))      if (pid === playerId) vp += 2;
  return vp;
}

function getPlayerPorts(board, playerId) {
  if (!board.ports) return [];
  const { settlements, cities } = board.pieces;
  return board.ports.filter(p =>
    settlements[p.vertexA] === playerId || cities[p.vertexA] === playerId ||
    settlements[p.vertexB] === playerId || cities[p.vertexB] === playerId
  );
}

function getBestTradeRate(board, playerId, resource) {
  let rate = 4;
  for (const port of getPlayerPorts(board, playerId)) {
    if ((port.type === 'any' || port.type === resource) && port.rate < rate) rate = port.rate;
  }
  return rate;
}

function tradeWithBank(board, playerId, giveResource, takeResource) {
  if (giveResource === takeResource) return { valid: false, reason: "can't trade a resource for itself" };
  const rate = getBestTradeRate(board, playerId, giveResource);
  const res  = board.players[playerId];
  if ((res[giveResource] || 0) < rate) return { valid: false, reason: `need ${rate} ${giveResource} to trade` };
  res[giveResource] -= rate;
  res[takeResource]  = (res[takeResource] || 0) + 1;
  return { valid: true, rate, reason: '' };
}

function checkWinner(board) {
  if (board.gameState.gameEnded) return board.gameState.winner;
  for (const playerId of board.gameState.playerOrder) {
    if (calculateVP(board, playerId) >= 10) {
      board.gameState.winner    = playerId;
      board.gameState.gameEnded = true;
      return playerId;
    }
  }
  return null;
}

const BoardCore = {
  generateBoard: generateBoardWithGraph,
  getNeighbors,
  computeGraph,
  TILE_RESOURCE,
  BUILD_COSTS,
  canPlaceSettlement,
  canPlaceRoad,
  canUpgradeToCity,
  rollDice,
  distributeResources,
  getCurrentPlayer,
  endTurn,
  advanceOpening,
  giveStartingResources,
  canAfford,
  payCost,
  calculateVP,
  checkWinner,
  getPlayerPorts,
  getBestTradeRate,
  tradeWithBank,
};

// Dual export: Node.js module OR browser global
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
  module.exports = BoardCore;
} else {
  window.BoardCore = BoardCore;
}
