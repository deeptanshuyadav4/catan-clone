window.Board = (() => {
  const HEX_SIZE   = 50;
  const HEX_WIDTH  = Math.sqrt(3) * HEX_SIZE;  // ~86.6 — center-to-center within a row
  const ROW_HEIGHT = 1.5 * HEX_SIZE;            // 75   — center-to-center between rows
  const ROW_COUNTS = [4, 5, 6, 7, 6, 5, 4];    // 37 hexes total
  const CENTER_X   = 400;
  const CENTER_Y   = 400;

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

  return { generateBoard, getNeighbors };
})();
