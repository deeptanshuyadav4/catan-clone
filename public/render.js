window.Render = (() => {
  const SVG_NS   = 'http://www.w3.org/2000/svg';
  const HEX_SIZE = 50;

  // Fill and stroke colors for each tile type
  const TILE_COLORS = {
    forest:    { fill: '#5fa830', stroke: '#3a6b18' },
    pasture:   { fill: '#9bc94a', stroke: '#62872a' },
    fields:    { fill: '#f0c040', stroke: '#a88200' },
    hills:     { fill: '#d97a3a', stroke: '#924e1c' },
    mountains: { fill: '#9a9a9a', stroke: '#555555' },
    desert:    { fill: '#e8c98a', stroke: '#a0854a' },
  };

  // How many probability dots to show under each number token
  const DOT_COUNT = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

  // Shorthand: create an SVG element with attributes in one call.
  // SVG elements must use createElementNS (not createElement) or the browser ignores them.
  function el(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // Compute the "points" attribute for a pointy-top hexagon centered at (cx, cy).
  // The 6 vertices sit at angles 30°, 90°, 150°, 210°, 270°, 330° from center.
  function hexPoints(cx, cy) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const rad = (Math.PI / 180) * (60 * i + 30);
      pts.push(`${(cx + HEX_SIZE * Math.cos(rad)).toFixed(2)},${(cy + HEX_SIZE * Math.sin(rad)).toFixed(2)}`);
    }
    return pts.join(' ');
  }

  // Draw a single hex tile polygon. Returns the element so click handlers can be attached.
  function drawTile(svg, pos, tileType, idx) {
    const c = TILE_COLORS[tileType];
    const poly = el('polygon', {
      points:          hexPoints(pos.x, pos.y),
      fill:            c.fill,
      stroke:          c.stroke,
      'stroke-width':  2.5,
      'stroke-linejoin': 'round',
      class:           'hex-tile',
      'data-idx':      idx,
      style:           'cursor:pointer',
    });
    svg.appendChild(poly);
    return poly;
  }

  // Draw the white circle + number + probability dots for non-desert tiles.
  function drawNumberToken(svg, pos, number) {
    const cx  = pos.x;
    const cy  = pos.y + 6;        // slightly below tile center
    const red = number === 6 || number === 8;
    const ink = red ? '#c41e1e' : '#111111';

    // White backing circle
    svg.appendChild(el('circle', {
      cx, cy, r: 16,
      fill:         'white',
      stroke:       '#bbbbbb',
      'stroke-width': 1,
    }));

    // Number text — baseline at cy+4 so the digit reads as vertically centered
    const txt = el('text', {
      x:              cx,
      y:              cy + 4,
      'text-anchor':  'middle',
      'font-size':    13,
      'font-weight':  'bold',
      'font-family':  'Arial, sans-serif',
      fill:           ink,
    });
    txt.textContent = number;
    svg.appendChild(txt);

    // Probability dots — small filled circles near the bottom of the token
    const count  = DOT_COUNT[number] || 0;
    const dotR   = 1.8;
    const spacing = 5;
    const dotY   = cy + 12;
    const startX = cx - ((count - 1) * spacing) / 2;
    for (let d = 0; d < count; d++) {
      svg.appendChild(el('circle', {
        cx:   startX + d * spacing,
        cy:   dotY,
        r:    dotR,
        fill: ink,
      }));
    }
  }

  // Draw a simple pawn shape to mark where the robber is.
  // Uses two overlapping SVG shapes: a circle head + an ellipse body.
  function drawRobber(svg, pos) {
    const cx = pos.x;
    const cy = pos.y - 8;   // anchor point; head/body are drawn relative to this

    // Head
    svg.appendChild(el('circle', {
      cx,
      cy:            cy - 12,
      r:             7,
      fill:          '#1a1a2e',
      stroke:        '#777',
      'stroke-width': 1.5,
    }));

    // Body
    svg.appendChild(el('ellipse', {
      cx,
      cy:            cy,
      rx:            9,
      ry:            10,
      fill:          '#1a1a2e',
      stroke:        '#777',
      'stroke-width': 1.5,
    }));
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  // Wipes the SVG and redraws the complete board from a board object
  // produced by window.Board.generateBoard().
  function renderBoard(svgElement, board) {
    svgElement.innerHTML = '';
    svgElement.setAttribute('viewBox', '0 0 800 800');

    const { positions, tiles, numbers, robber } = board;

    // 1. Draw all hex tile polygons first (bottom layer)
    for (let i = 0; i < positions.length; i++) {
      drawTile(svgElement, positions[i], tiles[i], i);
    }

    // 2. Draw number tokens on top of tiles (middle layer)
    for (const [idxStr, number] of Object.entries(numbers)) {
      drawNumberToken(svgElement, positions[parseInt(idxStr, 10)], number);
    }

    // 3. Draw robber on top of everything (top layer)
    drawRobber(svgElement, positions[robber]);
  }

  // Attaches a click listener to every hex tile element.
  // When a tile is clicked, calls onTileClick(tileIndex).
  function attachClickHandlers(svgElement, board, onTileClick) {
    svgElement.querySelectorAll('.hex-tile').forEach(tileEl => {
      tileEl.addEventListener('click', () => {
        onTileClick(parseInt(tileEl.getAttribute('data-idx'), 10));
      });
    });
  }

  return { renderBoard, attachClickHandlers };
})();
