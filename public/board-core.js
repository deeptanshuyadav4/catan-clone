'use strict';
// board-core.js — Pure game logic.
// Works as a Node.js require() module (server) AND a browser <script> tag (client).

const HEX_SIZE    = 50;
const HEX_WIDTH   = Math.sqrt(3) * HEX_SIZE;
const ROW_HEIGHT  = 1.5 * HEX_SIZE;
const MAP_PADDING = 80; // sea around the land, leaves room for ports

const TILE_RESOURCE = {
  forest: 'wood', hills: 'brick', fields: 'wheat', pasture: 'wool', mountains: 'ore', desert: null,
};

const RESOURCES = ['wood', 'brick', 'wheat', 'wool', 'ore'];
const DISCARD_LIMIT = 7;

const BUILD_COSTS = {
  road:       { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, wool: 1 },
  city:       { wheat: 2, ore: 3 },
};

// Pieces each player owns. Upgrading to a city gives the settlement back.
const PIECE_LIMITS = { road: 15, settlement: 5, city: 4 };

// ── Maps ─────────────────────────────────────────────────────────────────────
// Each map is drawn as text: 'o' is a land tile, 'd' a desert, anything else is sea.
// Tiles in a row are two characters apart, and each row is shifted one character
// from the row above, like bricks in a wall.
// Optional: tilePool / numberPool (exact pools), deserts (total count), ports (count).
const MAPS = {
  classic: {
    name: 'Classic', size: 'Small',
    rows: [
      '  o o o',
      ' o o o o',
      'o o o o o',
      ' o o o o',
      '  o o o',
    ],
    ports: 9,
  },
  grand: {
    name: 'Grand Isle', size: 'Medium',
    rows: [
      '   o o o o',
      '  o o o o o',
      ' o o o o o o',
      'o o o o o o o',
      ' o o o o o o',
      '  o o o o o',
      '   o o o o',
    ],
    tilePool:   { forest: 8, pasture: 8, fields: 7, hills: 6, mountains: 6, desert: 2 },
    numberPool: [2, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 8, 8, 8, 8,
                 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 11, 11, 11, 12],
    ports: 9,
  },
  twin: {
    name: 'Twin Isles', size: 'Medium',
    rows: [
      '  o o o       o o o',
      ' o o o o     o o o o',
      'o o o o o   o o o o o',
      ' o o o o     o o o o',
      '  o o o       o o o',
    ],
    ports: 12,
  },
  lakeland: {
    name: 'Lakeland', size: 'Big',
    rows: [
      '     o o o o o o',
      '    o o o o o o o',
      '   o o o     o o o',
      '  o o o o o o o o o',
      ' o o o o o   o o o o',
      'o o o o o     o o o o',
      ' o o o o o o o o o o',
      '  o o o o o o o o o',
      '   o o o     o o o',
      '    o o o o o o o',
      '     o o o o o o',
    ],
    ports: 16,
  },
  world: {
    name: 'World', size: 'Huge',
    rows: [
      '  o o o o o o   o o     o o o     o o o o o o o',
      ' o o o o o o o   o     o o o o   o o o o d o o o',
      '  o o o o o o         o o o     o o o o o o o o   o',
      '     o o o o                     o o o o o o o   o',
      '      o o           o o d o         o o o',
      '                     o o o o',
      '        o o o       o o o o',
      '         o o o o       o o             o o o',
      '        o o o         o             o o d o',
      '           o o                         o o',
      '          o',
    ],
    deserts: 4,
    ports: 22,
  },
  usa: {
    name: 'USA', size: 'Huge',
    rows: [
      'o o o o o o o o o               o o',
      ' o o o o o o o o o o   o o   o o o o',
      'o o o o o o o o o o o   o   o o o o',
      ' o o o o o o o o o o o   o o o o o o',
      'o o o o o o o o o o o o o o o o o',
      ' o o o d o o o o o o o o o o o o o',
      'o o d o o o o o o o o o o o o o',
      '   o o d o o o o o o o o o o o o',
      '    o o d o o o o o o o o o o',
      '             o o o o o   o o o',
      '              o o o         o',
      '                 o           o',
    ],
    deserts: 5,
    ports: 18,
  },
};
const DEFAULT_MAP = 'grand';

// Share of each resource on maps without an exact pool (the standard board is 4:4:4:3:3).
const TILE_SHARES   = { forest: 4, pasture: 4, fields: 4, hills: 3, mountains: 3 };
// The standard 18 number tokens; bigger maps repeat the set.
const NUMBER_SET    = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];

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

// Ports go on coastal edges (edges with land on one side only), spread evenly around the
// coast, never two on the same corner. The ship sits out at sea, away from its tile.
function generatePorts(board, rng, count) {
  const { graph, positions } = board;
  const coastal = graph.edges
    .map((e, i) => ({ ...e, idx: i }))
    .filter(e => e.tiles.length === 1);

  const cx = positions.reduce((s, p) => s + p.x, 0) / positions.length;
  const cy = positions.reduce((s, p) => s + p.y, 0) / positions.length;
  const angle = e => Math.atan2((e.y1 + e.y2) / 2 - cy, (e.x1 + e.x2) / 2 - cx);
  coastal.sort((a, b) => angle(a) - angle(b));

  // Where the ship for a port on this edge would sit: out at sea, away from its tile
  const iconFor = edge => {
    const mx   = (edge.x1 + edge.x2) / 2;
    const my   = (edge.y1 + edge.y2) / 2;
    const tile = positions[edge.tiles[0]];
    const dist = Math.hypot(mx - tile.x, my - tile.y);
    return { x: Math.round(mx + (mx - tile.x) / dist * 34), y: Math.round(my + (my - tile.y) / dist * 34) };
  };

  if (count === undefined) count = Math.max(4, Math.round(coastal.length / 4.67));
  const n      = coastal.length;
  const used   = new Set();
  const chosen = [];
  const icons  = [];
  // A port fits if it shares no corner with another and its ship isn't crowding another ship
  const fits = e => {
    if (used.has(e.vertexA) || used.has(e.vertexB)) return false;
    const icon = iconFor(e);
    return icons.every(o => Math.hypot(o.x - icon.x, o.y - icon.y) > 70);
  };
  for (let i = 0; i < count && chosen.length < n; i++) {
    let j = Math.round(i * n / count) % n;
    let found = false;
    for (let tries = 0; tries < n; tries++, j = (j + 1) % n) {
      if (fits(coastal[j])) { found = true; break; }
    }
    if (!found) break;
    const edge = coastal[j];
    used.add(edge.vertexA);
    used.add(edge.vertexB);
    icons.push(iconFor(edge));
    chosen.push(edge);
  }

  // Same mix as the standard board: 4 of every 9 ports are 3:1, the rest 2:1 for one resource
  const anyCount = Math.round(chosen.length * 4 / 9);
  const types = Array(anyCount).fill('any');
  for (let i = 0; types.length < chosen.length; i++) types.push(['wood', 'brick', 'wheat', 'wool', 'ore'][i % 5]);
  const portTypes = shuffle(types, rng);

  return chosen.map((edge, i) => {
    const type = portTypes[i];
    const icon = icons[i];
    return {
      edgeIdx: edge.idx,
      type,
      rate:    type === 'any' ? 3 : 2,
      iconX:   icon.x,
      iconY:   icon.y,
      vertexA: edge.vertexA,
      vertexB: edge.vertexB,
    };
  });
}

// Turns a map's text rows into tile centre positions plus the size of the whole picture.
function layoutMap(rows) {
  const cells = [];
  rows.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      if (line[col] === 'o' || line[col] === 'd') cells.push({ row, col, desert: line[col] === 'd' });
    }
  });
  const minCol = Math.min(...cells.map(c => c.col));
  const maxCol = Math.max(...cells.map(c => c.col));
  const minRow = Math.min(...cells.map(c => c.row));
  const maxRow = Math.max(...cells.map(c => c.row));

  const positions = cells.map(c => ({
    x: MAP_PADDING + HEX_WIDTH / 2 + (c.col - minCol) * HEX_WIDTH / 2,
    y: MAP_PADDING + HEX_SIZE + (c.row - minRow) * ROW_HEIGHT,
  }));
  return {
    positions,
    fixed:  cells.map(c => (c.desert ? 'desert' : null)),
    width:  2 * MAP_PADDING + HEX_WIDTH + (maxCol - minCol) * HEX_WIDTH / 2,
    height: 2 * MAP_PADDING + 2 * HEX_SIZE + (maxRow - minRow) * ROW_HEIGHT,
  };
}

// Tiles still to be shuffled onto the map (fixed deserts are already placed).
function buildTilePool(map, landCount, fixedDeserts) {
  let counts;
  if (map.tilePool) {
    counts = { ...map.tilePool };
  } else {
    const deserts = map.deserts !== undefined ? map.deserts : Math.max(1, Math.round(landCount / 19));
    const randomDeserts = Math.max(0, deserts - fixedDeserts);
    const rest  = landCount - fixedDeserts - randomDeserts;
    const total = Object.values(TILE_SHARES).reduce((s, n) => s + n, 0);
    counts = {};
    const remainders = [];
    for (const [type, share] of Object.entries(TILE_SHARES)) {
      counts[type] = Math.floor(rest * share / total);
      remainders.push([type, rest * share / total - counts[type]]);
    }
    let missing = rest - Object.values(counts).reduce((s, n) => s + n, 0);
    remainders.sort((a, b) => b[1] - a[1]);
    for (let i = 0; missing > 0; i++, missing--) counts[remainders[i % remainders.length][0]]++;
    counts.desert = randomDeserts;
  }
  const pool = [];
  for (const type of ['forest', 'pasture', 'fields', 'hills', 'mountains', 'desert']) {
    for (let i = 0; i < (counts[type] || 0); i++) pool.push(type);
  }
  return pool;
}

function buildNumberPool(map, producing, rng) {
  if (map.numberPool) return [...map.numberPool];
  const pool = [];
  while (pool.length + NUMBER_SET.length <= producing) pool.push(...NUMBER_SET);
  pool.push(...shuffle([...NUMBER_SET], rng).slice(0, producing - pool.length));
  return pool;
}

// Moves 6s and 8s apart: while two touch, swap one with a number that has no red neighbours.
function spreadRedNumbers(positions, numbers, rng) {
  const isRed = n => n === 6 || n === 8;
  const tiles = Object.keys(numbers).map(Number);
  const near  = {};
  for (const t of tiles) near[t] = getNeighbors(t, positions).filter(n => numbers[n] !== undefined);

  for (let pass = 0; pass < 1000; pass++) {
    const bad = tiles.find(t => isRed(numbers[t]) && near[t].some(n => isRed(numbers[n])));
    if (bad === undefined) return true;
    const options = tiles.filter(t =>
      !isRed(numbers[t]) && !near[t].some(n => n !== bad && isRed(numbers[n])));
    if (options.length === 0) return false;
    const swap = options[Math.floor(rng() * options.length)];
    [numbers[bad], numbers[swap]] = [numbers[swap], numbers[bad]];
  }
  return false;
}

function generateBoard(seed, mapId, balanced) {
  if (seed === undefined) seed = Math.floor(Math.random() * 0xFFFFFFFF);
  if (!MAPS[mapId]) mapId = DEFAULT_MAP;
  const map = MAPS[mapId];
  const rng = mulberry32(seed);

  const { positions, fixed, width, height } = layoutMap(map.rows);
  const fixedDeserts = fixed.filter(Boolean).length;
  const pool  = shuffle(buildTilePool(map, positions.length, fixedDeserts), rng);
  const tiles = [];
  let next = 0;
  for (let i = 0; i < positions.length; i++) tiles.push(fixed[i] || pool[next++]);

  const producing       = tiles.filter(t => t !== 'desert').length;
  const shuffledNumbers = shuffle(buildNumberPool(map, producing, rng), rng);

  const numbers = {};
  let numIdx = 0;
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== 'desert') numbers[i] = shuffledNumbers[numIdx++];
  }
  if (balanced) spreadRedNumbers(positions, numbers, rng);

  const robber = tiles.indexOf('desert');
  return {
    mapId, positions, tiles, numbers, robber, seed,
    view:     { width, height },
    bankSize: map.bank || Math.max(19, positions.length),
  };
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
function generateBoardWithGraph(seed, mapId, balanced) {
  const board  = _generateBoard(seed, mapId, balanced);
  board.graph  = computeGraph(board.positions);
  board.ports  = generatePorts(board, mulberry32(board.seed ^ 0x9E3779B9), MAPS[board.mapId].ports);
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
    pendingDiscards:      {},
    winner:               null,
    gameEnded:            false,
    turnStartedAt:        Date.now(),
    stats:                { startedAt: Date.now(), endedAt: null, turns: 0, rolls: {}, gained: {} },
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

function handSize(board, playerId) {
  const res = board.players[playerId];
  if (!res) return 0;
  return RESOURCES.reduce((sum, r) => sum + (res[r] || 0), 0);
}

function computeDiscards(board) {
  const discards = {};
  for (const playerId of board.gameState.playerOrder) {
    const total = handSize(board, playerId);
    if (total > DISCARD_LIMIT) discards[playerId] = Math.floor(total / 2);
  }
  return discards;
}

// Opponents with a settlement/city touching this tile who have at least 1 card.
function robberVictims(board, tileIdx, thiefId) {
  const victims = [];
  board.graph.vertices.forEach((vertex, vIdx) => {
    if (!vertex.tiles.includes(tileIdx)) return;
    const owner = board.pieces.settlements[vIdx] || board.pieces.cities[vIdx];
    if (!owner || owner === thiefId || victims.includes(owner)) return;
    if (handSize(board, owner) > 0) victims.push(owner);
  });
  return victims;
}

// Moves the robber and steals 1 random card. With one possible victim it is
// picked automatically; with several, victimId must be one of them.
function moveRobber(board, tileIdx, thiefId, victimId) {
  if (!Number.isInteger(tileIdx) || tileIdx < 0 || tileIdx >= board.tiles.length) {
    return { valid: false, reason: 'invalid tile' };
  }
  if (tileIdx === board.robber) return { valid: false, reason: 'robber must move to a different tile' };

  const victims = robberVictims(board, tileIdx, thiefId);
  if (victims.length === 1) victimId = victims[0];
  if (victims.length > 1 && !victims.includes(victimId)) {
    return { valid: false, reason: 'choose a player to steal from' };
  }

  board.robber = tileIdx;
  board.gameState.turnPhase = 'build';
  if (victims.length === 0) return { valid: true, victim: null, stolen: null, reason: '' };

  const res    = board.players[victimId];
  const pool   = RESOURCES.flatMap(r => Array(res[r] || 0).fill(r));
  const stolen = pool[Math.floor(Math.random() * pool.length)];
  res[stolen] -= 1;
  board.players[thiefId][stolen] = (board.players[thiefId][stolen] || 0) + 1;
  return { valid: true, victim: victimId, stolen, reason: '' };
}

function discardResources(board, playerId, resources) {
  const gs     = board.gameState;
  const needed = gs.pendingDiscards && gs.pendingDiscards[playerId];
  if (!needed) return { valid: false, reason: 'nothing to discard' };

  let total = 0;
  for (const [r, amount] of Object.entries(resources || {})) {
    if (!RESOURCES.includes(r))               return { valid: false, reason: `invalid resource: ${r}` };
    if (!Number.isInteger(amount) || amount < 0) return { valid: false, reason: 'invalid discard amount' };
    total += amount;
  }
  if (total !== needed) return { valid: false, reason: `must discard exactly ${needed} cards` };

  const res = board.players[playerId];
  for (const [r, amount] of Object.entries(resources)) {
    if (amount > (res[r] || 0)) return { valid: false, reason: `not enough ${r} to discard` };
  }

  for (const [r, amount] of Object.entries(resources)) res[r] -= amount;
  delete gs.pendingDiscards[playerId];
  if (Object.keys(gs.pendingDiscards).length === 0) gs.turnPhase = 'robber';

  return { valid: true, reason: '' };
}

// Cards of one resource still in the bank: the bank's supply minus what players hold.
function bankCount(board, resource) {
  const held = Object.values(board.players).reduce((sum, res) => sum + (res[resource] || 0), 0);
  return (board.bankSize || 19) - held;
}

function recordGain(board, playerId, resource, amount) {
  const stats = board.gameState.stats;
  if (!stats) return;
  const mine = stats.gained[playerId] || (stats.gained[playerId] = {});
  mine[resource] = (mine[resource] || 0) + amount;
}

// Returns log lines describing who got what.
function distributeResources(board, rolledNumber) {
  if (rolledNumber === 7) {
    return { type: 'robber', discards: computeDiscards(board), log: [] };
  }

  const producingTiles = new Set();
  for (let idx = 0; idx < board.tiles.length; idx++) {
    if (board.numbers[idx] === rolledNumber && idx !== board.robber) producingTiles.add(idx);
  }

  // Work out what everyone is owed first, so the bank can be checked per resource
  const owed = {};
  board.graph.vertices.forEach((vertex, vIdx) => {
    if (!vertex.tiles.some(t => producingTiles.has(t))) return;
    const playerId = board.pieces.settlements[vIdx] || board.pieces.cities[vIdx] || null;
    if (!playerId) return;
    const amount = board.pieces.cities[vIdx] ? 2 : 1;
    vertex.tiles.forEach(tileIdx => {
      if (!producingTiles.has(tileIdx)) return;
      const resource = TILE_RESOURCE[board.tiles[tileIdx]];
      if (!resource) return;
      if (!owed[resource]) owed[resource] = {};
      owed[resource][playerId] = (owed[resource][playerId] || 0) + amount;
    });
  });

  // If the bank can't pay everyone a resource, nobody gets it,
  // unless only one player is owed it: they take what's left.
  const distribution = {};
  const shortages    = [];
  for (const resource of RESOURCES) {
    let pay = owed[resource];
    if (!pay) continue;
    const total = Object.values(pay).reduce((s, n) => s + n, 0);
    const left  = bankCount(board, resource);
    if (total > left) {
      const owners = Object.keys(pay);
      if (owners.length === 1 && left > 0) pay = { [owners[0]]: left };
      else { shortages.push(resource); continue; }
    }
    for (const [playerId, amount] of Object.entries(pay)) {
      board.players[playerId][resource] += amount;
      recordGain(board, playerId, resource, amount);
      if (!distribution[playerId]) distribution[playerId] = {};
      distribution[playerId][resource] = amount;
    }
  }

  const log = Object.entries(distribution).map(([pid, res]) =>
    `${pid} got ${Object.entries(res).map(([r, a]) => `${a} ${r}`).join(', ')}`);
  for (const r of shortages) log.push(`The bank doesn't have enough ${r}`);
  if (log.length === 0) log.push('Nobody got anything');

  return { type: 'distribute', rolledNumber, distribution, shortages, log };
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
  gs.diceRolled    = false;
  gs.turnPhase     = 'roll';
  gs.turnStartedAt = Date.now();
  if (gs.stats) gs.stats.turns++;
}

function advanceOpening(board) {
  const gs = board.gameState;
  if (gs.openingStep === 'settlement') {
    gs.openingStep = 'road';
  } else {
    gs.openingStep = 'settlement';
    gs.openingTurn++;
    gs.turnStartedAt = Date.now();
    if (gs.openingTurn >= gs.openingOrder.length) {
      gs.phase              = 'main';
      gs.currentPlayerIndex = 0;
      gs.turnPhase          = 'roll';
    }
  }
}

function giveStartingResources(board, vertexIdx, playerId) {
  board.graph.vertices[vertexIdx].tiles.forEach(tileIdx => {
    const resource = TILE_RESOURCE[board.tiles[tileIdx]];
    if (!resource || bankCount(board, resource) < 1) return;
    board.players[playerId][resource] += 1;
    recordGain(board, playerId, resource, 1);
  });
}

function piecesLeft(board, playerId, type) {
  const placed = { road: board.pieces.roads, settlement: board.pieces.settlements, city: board.pieces.cities }[type];
  return PIECE_LIMITS[type] - Object.values(placed).filter(p => p === playerId).length;
}

// Length of the player's longest continuous road. A road can't continue
// through a corner where another player has built.
function longestRoad(board, playerId) {
  const { roads, settlements, cities } = board.pieces;
  const { edges, vertexEdges } = board.graph;
  const blocked = v => {
    const owner = settlements[v] || cities[v];
    return owner && owner !== playerId;
  };
  let best = 0;
  function walk(v, used) {
    best = Math.max(best, used.size);
    if (blocked(v)) return;
    for (const e of vertexEdges[v] || []) {
      if (roads[e] !== playerId || used.has(e)) continue;
      used.add(e);
      walk(edges[e].vertexA === v ? edges[e].vertexB : edges[e].vertexA, used);
      used.delete(e);
    }
  }
  for (const [eIdx, owner] of Object.entries(roads)) {
    if (owner !== playerId) continue;
    const e = edges[eIdx];
    walk(e.vertexA, new Set([Number(eIdx)]));
    walk(e.vertexB, new Set([Number(eIdx)]));
  }
  return best;
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
  if (bankCount(board, takeResource) < 1) return { valid: false, reason: `the bank has no ${takeResource} left` };
  res[giveResource] -= rate;
  res[takeResource]  = (res[takeResource] || 0) + 1;
  return { valid: true, rate, reason: '' };
}

function checkWinner(board) {
  if (board.gameState.gameEnded) return board.gameState.winner;
  const target = board.gameState.winTarget || 10;
  for (const playerId of board.gameState.playerOrder) {
    if (calculateVP(board, playerId) >= target) {
      board.gameState.winner    = playerId;
      board.gameState.gameEnded = true;
      if (board.gameState.stats) board.gameState.stats.endedAt = Date.now();
      return playerId;
    }
  }
  return null;
}

const BoardCore = {
  generateBoard: generateBoardWithGraph,
  getNeighbors,
  computeGraph,
  MAPS,
  DEFAULT_MAP,
  TILE_RESOURCE,
  BUILD_COSTS,
  PIECE_LIMITS,
  RESOURCES,
  bankCount,
  piecesLeft,
  longestRoad,
  canPlaceSettlement,
  canPlaceRoad,
  canUpgradeToCity,
  rollDice,
  distributeResources,
  handSize,
  computeDiscards,
  discardResources,
  robberVictims,
  moveRobber,
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
