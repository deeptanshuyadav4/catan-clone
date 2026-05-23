window.Board = (() => {
  const HEX_SIZE   = 50;
  const HEX_WIDTH  = Math.sqrt(3) * HEX_SIZE;  // ~86.6 — center-to-center within a row
  const ROW_HEIGHT = 1.5 * HEX_SIZE;            // 75   — center-to-center between rows
  const ROW_COUNTS = [4, 5, 6, 7, 6, 5, 4];    // 37 hexes total
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

  // Mulberry32: fast, seedable RNG. Returns a function that produces floats in [0, 1).
  // We use a seed so "Regenerate" can reproduce a board if the seed is shared.
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fisher-Yates shuffle using our seeded RNG instead of Math.random
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // Build the array of {x, y, row, col} centers for all 37 hexes.
  // Row 3 (the widest, 7 hexes) sits at CENTER_Y; rows above/below shift by ROW_HEIGHT each.
  // Within each row the hexes are evenly spaced HEX_WIDTH apart, centered on CENTER_X.
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

  // Main entry point. Returns everything the renderer needs.
  function generateBoard(seed) {
    if (seed === undefined) seed = Math.floor(Math.random() * 0xFFFFFFFF);
    const rng = mulberry32(seed);

    const positions = generatePositions();

    // --- Tile types ---
    // 8 forest + 8 pasture + 7 fields + 6 hills + 6 mountains + 2 desert = 37
    const tilePool = [
      ...Array(8).fill('forest'),
      ...Array(8).fill('pasture'),
      ...Array(7).fill('fields'),
      ...Array(6).fill('hills'),
      ...Array(6).fill('mountains'),
      ...Array(2).fill('desert'),
    ];
    const tiles = shuffle([...tilePool], rng);

    // --- Number tokens ---
    // 35 tokens for 35 non-desert tiles.
    // Base: 1×2, 3×3, 4×4, 4×5, 4×6, 4×8, 4×9, 4×10, 3×11, 1×12  = 32
    // Extra: one each of 4, 9, 10                                    = +3 → 35 total
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

    // Map tile index → number token, skipping desert tiles
    const numbers = {};
    let numIdx = 0;
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] !== 'desert') {
        numbers[i] = shuffledNumbers[numIdx++];
      }
    }

    // Robber starts on the first desert tile
    const robber = tiles.indexOf('desert');

    return { positions, tiles, numbers, robber, seed };
  }

  // Returns the indices of all hexes that share an edge with hex at `idx`.
  // For pointy-top hexes with our spacing, all 6 neighbors are exactly HEX_WIDTH
  // away from the center, so anything within 110 % of that distance is a neighbor.
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

  // Derives the full vertex-and-edge graph from the array of hex centers.
  //
  // A "vertex" is a corner point where up to 3 hexes meet — this is where
  // players place settlements and cities in Catan.
  // An "edge" is one side of a hex — this is where players place roads.
  //
  // Because adjacent hexes share corners and sides, we deduplicate both
  // using string keys so each physical point / segment appears only once.
  function computeGraph(positions) {
    const vertexMap = new Map();  // "x.xx,y.xx" → vertex index
    const vertices  = [];         // [{x, y, tiles:[tileIdx,...]}, ...]
    const edgeMap   = new Map();  // "minV-maxV" → edge index
    const edges     = [];         // [{x1,y1,x2,y2, vertexA,vertexB, tiles:[...]}, ...]
    const vertexAdjacency = {};   // vIdx → [vIdx, ...]  (vertices linked by an edge)
    const vertexEdges     = {};   // vIdx → [eIdx, ...]  (edges that touch this vertex)

    // Look up or create a vertex at (px, py); add tileIdx to its tile list.
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

      // Compute the 6 corner vertex indices for this hex (same angles as render.js)
      const corners = [];
      for (let i = 0; i < 6; i++) {
        const rad = (Math.PI / 180) * (60 * i + 30);
        const px  = cx + HEX_SIZE * Math.cos(rad);
        const py  = cy + HEX_SIZE * Math.sin(rad);
        corners.push(getOrAddVertex(px, py, tileIdx));
      }

      // Each hex side connects corner[i] → corner[(i+1) % 6]
      for (let i = 0; i < 6; i++) {
        const vA     = corners[i];
        const vB     = corners[(i + 1) % 6];
        const eKey   = `${Math.min(vA, vB)}-${Math.max(vA, vB)}`;

        if (!edgeMap.has(eKey)) {
          const eIdx = edges.length;
          edgeMap.set(eKey, eIdx);
          edges.push({
            x1: vertices[vA].x, y1: vertices[vA].y,
            x2: vertices[vB].x, y2: vertices[vB].y,
            vertexA: vA, vertexB: vB,
            tiles: [],
          });
          // Wire up adjacency and edge-membership for both endpoints
          if (!vertexAdjacency[vA]) vertexAdjacency[vA] = [];
          if (!vertexAdjacency[vB]) vertexAdjacency[vB] = [];
          if (!vertexEdges[vA])     vertexEdges[vA]     = [];
          if (!vertexEdges[vB])     vertexEdges[vB]     = [];
          vertexAdjacency[vA].push(vB);
          vertexAdjacency[vB].push(vA);
          vertexEdges[vA].push(eIdx);
          vertexEdges[vB].push(eIdx);
        }

        // Every hex that borders this edge adds itself to the tile list (max 2)
        const eIdx = edgeMap.get(eKey);
        if (!edges[eIdx].tiles.includes(tileIdx)) edges[eIdx].tiles.push(tileIdx);
      }
    }

    return { vertices, edges, vertexAdjacency, vertexEdges };
  }

  // Augment generateBoard to include the pre-computed graph so callers always
  // have vertex/edge data alongside tiles and numbers without a separate call.
  const _generateBoard = generateBoard;
  function generateBoardWithGraph(seed) {
    const board  = _generateBoard(seed);
    board.graph  = computeGraph(board.positions);
    board.pieces = { settlements: {}, cities: {}, roads: {} };
    board.players = {
      red:    { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
      blue:   { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
      white:  { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
      orange: { wood: 0, brick: 0, wheat: 0, wool: 0, ore: 0 },
    };
    board.gameState = {
      phase:                  'opening',
      openingTurn:            0,
      openingOrder:           ['red', 'blue', 'white', 'orange', 'orange', 'white', 'blue', 'red'],
      openingStep:            'settlement',  // 'settlement' | 'road'
      lastSettlementVertex:   null,
      currentPlayerIndex:     0,
      playerOrder:            ['red', 'blue', 'white', 'orange'],
      turnPhase:              'roll',
      diceRolled:             false,
      winner:                 null,
      gameEnded:              false,
    };
    return board;
  }

  function canPlaceSettlement(board, vertexIdx, playerId) {
    const { settlements, cities, roads } = board.pieces;
    if (settlements[vertexIdx] || cities[vertexIdx]) {
      return { valid: false, reason: 'spot is taken' };
    }
    for (const adjV of (board.graph.vertexAdjacency[vertexIdx] || [])) {
      if (settlements[adjV] || cities[adjV]) {
        return { valid: false, reason: 'too close to another settlement' };
      }
    }
    // Main phase only: settlement must be adjacent to one of the player's roads
    if (board.gameState.phase !== 'opening') {
      const hasRoad = (board.graph.vertexEdges[vertexIdx] || []).some(eIdx => roads[eIdx] === playerId);
      if (!hasRoad) return { valid: false, reason: 'settlement must connect to your road' };
    }
    return { valid: true, reason: '' };
  }

  function canPlaceRoad(board, edgeIdx, playerId) {
    const { roads, settlements, cities } = board.pieces;
    if (roads[edgeIdx]) {
      return { valid: false, reason: 'road already exists' };
    }
    const edge = board.graph.edges[edgeIdx];
    // Opening phase: road must touch the settlement just placed
    if (board.gameState.phase === 'opening') {
      const lastV = board.gameState.lastSettlementVertex;
      if (edge.vertexA !== lastV && edge.vertexB !== lastV) {
        return { valid: false, reason: 'road must touch the settlement you just placed' };
      }
      return { valid: true, reason: '' };
    }
    for (const vIdx of [edge.vertexA, edge.vertexB]) {
      if (settlements[vIdx] === playerId || cities[vIdx] === playerId) {
        return { valid: true, reason: '' };
      }
      for (const adjEdgeIdx of (board.graph.vertexEdges[vIdx] || [])) {
        if (adjEdgeIdx !== edgeIdx && roads[adjEdgeIdx] === playerId) {
          return { valid: true, reason: '' };
        }
      }
    }
    return { valid: false, reason: 'road must connect to your settlement or another road' };
  }

  function canUpgradeToCity(board, vertexIdx, playerId) {
    const { settlements, cities } = board.pieces;
    if (cities[vertexIdx]) {
      return { valid: false, reason: 'already a city' };
    }
    if (settlements[vertexIdx] !== playerId) {
      return { valid: false, reason: "you don't have a settlement here" };
    }
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

    // Build the set of tile indices that fire on this number, minus the robber tile
    const producingTiles = new Set();
    for (let idx = 0; idx < board.tiles.length; idx++) {
      if (board.numbers[idx] === rolledNumber && idx !== board.robber) {
        producingTiles.add(idx);
      }
    }

    console.log(`[distribute] rolled ${rolledNumber} | producingTiles: [${[...producingTiles]}] | robber on tile ${board.robber}`);
    console.log(`[distribute] settlements:`, JSON.stringify(board.pieces.settlements));
    for (const tIdx of producingTiles) {
      const adjVerts = board.graph.vertices
        .map((v, i) => v.tiles.includes(tIdx) ? i : -1)
        .filter(i => i >= 0);
      console.log(`[distribute] tile ${tIdx} (${board.tiles[tIdx]} #${board.numbers[tIdx]}) → vertices: [${adjVerts}]`);
      for (const vIdx of adjVerts) {
        const s = board.pieces.settlements[vIdx];
        const c = board.pieces.cities[vIdx];
        if (s || c) console.log(`  → vertex ${vIdx}: ${s ? 'settlement' : 'city'} = ${s || c}`);
      }
    }

    const distribution = {};

    board.graph.vertices.forEach((vertex, vIdx) => {
      // Skip vertices that don't touch any producing tile
      if (!vertex.tiles.some(t => producingTiles.has(t))) return;

      const playerId = board.pieces.settlements[vIdx] || board.pieces.cities[vIdx] || null;
      if (!playerId) return;
      const amount = board.pieces.cities[vIdx] ? 2 : 1;

      // Award resources for every producing tile this vertex touches
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
    for (const [r, amount] of Object.entries(cost)) {
      res[r] = (res[r] || 0) - amount;
    }
  }

  function calculateVP(board, playerId) {
    let vp = 0;
    for (const pid of Object.values(board.pieces.settlements)) {
      if (pid === playerId) vp += 1;
    }
    for (const pid of Object.values(board.pieces.cities)) {
      if (pid === playerId) vp += 2;
    }
    return vp;
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

  return { generateBoard: generateBoardWithGraph, getNeighbors, computeGraph, TILE_RESOURCE, BUILD_COSTS, canPlaceSettlement, canPlaceRoad, canUpgradeToCity, rollDice, distributeResources, getCurrentPlayer, endTurn, advanceOpening, giveStartingResources, canAfford, payCost, calculateVP, checkWinner };
})();
