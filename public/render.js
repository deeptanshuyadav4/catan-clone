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

  const TILE_EMOJI = {
    forest: '🌲', hills: '🧱', pasture: '🐑', fields: '🌾', mountains: '⛰️', desert: '🌵',
  };

  function drawTileIcon(svgElement, pos, tileType) {
    const txt = el('text', {
      x:                  pos.x,
      y:                  pos.y - 22,
      'text-anchor':      'middle',
      'dominant-baseline': 'middle',
      'font-size':        28,
      'pointer-events':   'none',
    });
    txt.textContent = TILE_EMOJI[tileType] || '';
    svgElement.appendChild(txt);
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

    // 2. Draw resource icons above tiles, below number tokens
    for (let i = 0; i < positions.length; i++) {
      drawTileIcon(svgElement, positions[i], tiles[i]);
    }

    // 3. Draw number tokens on top of icon layer
    for (const [idxStr, number] of Object.entries(numbers)) {
      drawNumberToken(svgElement, positions[parseInt(idxStr, 10)], number);
    }

    // 4. Draw robber on top of everything (top layer)
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

  // Overlays the vertex-and-edge graph on top of the board for visual verification.
  // Everything is placed in a single <g id="graph-debug"> group so the caller can
  // show/hide the whole overlay just by toggling that group's display style.
  // Safe to call multiple times — removes the previous group before drawing a new one.
  function drawGraphDebug(svgElement, board) {
    const existing = svgElement.querySelector('#graph-debug');
    if (existing) existing.remove();

    const { graph } = board;
    if (!graph) return;

    const g = el('g', { id: 'graph-debug' });

    // Edges first so vertex circles paint on top and remain easy to see
    for (const edge of graph.edges) {
      g.appendChild(el('line', {
        x1: edge.x1, y1: edge.y1,
        x2: edge.x2, y2: edge.y2,
        stroke:           'rgba(0, 0, 0, 0.25)',
        'stroke-width':   1.5,
      }));
    }

    // Vertices — one small circle per unique corner point
    for (const vertex of graph.vertices) {
      g.appendChild(el('circle', {
        cx:             vertex.x,
        cy:             vertex.y,
        r:              4,
        fill:           'rgba(255, 255, 255, 0.6)',
        stroke:         '#1a1a1a',
        'stroke-width': 1,
      }));
    }

    svgElement.appendChild(g);
  }

  // Draws all placed roads, settlements, and cities into a <g id="pieces-layer">.
  // Inserts the group below the transparent click-handler groups so hover areas
  // stay on top and don't get buried under piece shapes.
  // Safe to call after every piece placement — removes and replaces the old group.
  function drawPieces(svgElement, board, playerColors) {
    const existing = svgElement.querySelector('#pieces-layer');
    if (existing) existing.remove();

    const g = el('g', { id: 'pieces-layer' });
    const { graph, pieces } = board;

    // Roads first — drawn lowest so settlements/cities paint on top at junctions
    for (const [eIdxStr, playerId] of Object.entries(pieces.roads)) {
      const edge  = graph.edges[parseInt(eIdxStr, 10)];
      const mx    = (edge.x1 + edge.x2) / 2;
      const my    = (edge.y1 + edge.y2) / 2;
      const len   = Math.sqrt((edge.x2 - edge.x1) ** 2 + (edge.y2 - edge.y1) ** 2);
      const angle = Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1) * 180 / Math.PI;
      g.appendChild(el('rect', {
        x: mx - len / 2, y: my - 5, width: len, height: 10, rx: 3,
        fill:           playerColors[playerId] || '#888',
        stroke:         '#1a1a1a',
        'stroke-width': 1.5,
        transform:      `rotate(${angle},${mx},${my})`,
      }));
    }

    // Settlements — 5-point polygon: triangular roof + rectangular base, 18×20px
    for (const [vIdxStr, playerId] of Object.entries(pieces.settlements)) {
      const { x: vx, y: vy } = graph.vertices[parseInt(vIdxStr, 10)];
      g.appendChild(el('polygon', {
        points: [
          `${vx},${vy - 10}`,        // roof peak
          `${vx + 9},${vy - 2}`,     // right eave
          `${vx + 9},${vy + 10}`,    // bottom-right
          `${vx - 9},${vy + 10}`,    // bottom-left
          `${vx - 9},${vy - 2}`,     // left eave
        ].join(' '),
        fill:              playerColors[playerId] || '#888',
        stroke:            '#1a1a1a',
        'stroke-width':    1.5,
        'stroke-linejoin': 'round',
      }));
    }

    // Cities — 12-point castle silhouette: 3 merlons atop a wide base, 24×26px
    for (const [vIdxStr, playerId] of Object.entries(pieces.cities)) {
      const { x: vx, y: vy } = graph.vertices[parseInt(vIdxStr, 10)];
      g.appendChild(el('polygon', {
        points: [
          `${vx - 12},${vy - 13}`,   // left merlon  top-left
          `${vx - 6},${vy - 13}`,    // left merlon  top-right
          `${vx - 6},${vy - 5}`,     // first gap    floor-left
          `${vx - 3},${vy - 5}`,     // first gap    floor-right
          `${vx - 3},${vy - 13}`,    // middle merlon top-left
          `${vx + 3},${vy - 13}`,    // middle merlon top-right
          `${vx + 3},${vy - 5}`,     // second gap   floor-left
          `${vx + 6},${vy - 5}`,     // second gap   floor-right
          `${vx + 6},${vy - 13}`,    // right merlon top-left
          `${vx + 12},${vy - 13}`,   // right merlon top-right
          `${vx + 12},${vy + 13}`,   // bottom-right
          `${vx - 12},${vy + 13}`,   // bottom-left
        ].join(' '),
        fill:              playerColors[playerId] || '#888',
        stroke:            '#1a1a1a',
        'stroke-width':    1.5,
        'stroke-linejoin': 'round',
      }));
    }

    // Keep pieces below the transparent click-handler layers
    const vHandlers = svgElement.querySelector('#vertex-handlers');
    if (vHandlers) svgElement.insertBefore(g, vHandlers);
    else           svgElement.appendChild(g);
  }

  // Transparent circles at every vertex (radius 12). Larger than the debug dots
  // so they are easy to click. Show a white highlight on hover.
  // stroke="rgba(0,0,0,0)" keeps a transparent stroke that still hit-tests.
  function attachVertexClickHandlers(svgElement, board, onVertexClick) {
    const existing = svgElement.querySelector('#vertex-handlers');
    if (existing) existing.remove();

    const g = el('g', { id: 'vertex-handlers' });
    board.graph.vertices.forEach((vertex, vIdx) => {
      const c = el('circle', {
        cx: vertex.x, cy: vertex.y, r: 12,
        fill:             'rgba(0,0,0,0)',
        style:            'cursor:pointer',
        'data-vertex-idx': vIdx,
      });
      c.addEventListener('mouseenter', () => c.setAttribute('fill', 'rgba(255,255,255,0.4)'));
      c.addEventListener('mouseleave', () => c.setAttribute('fill', 'rgba(0,0,0,0)'));
      c.addEventListener('click', (e) => { e.stopPropagation(); onVertexClick(vIdx); });
      g.appendChild(c);
    });
    svgElement.appendChild(g);
    console.log(`attachVertexClickHandlers: added ${board.graph.vertices.length} vertex hit circles`);
  }

  // Transparent thick lines along every edge (stroke-width 14).
  // stroke="rgba(0,0,0,0)" is transparent but still receives pointer events,
  // unlike stroke="none" which disables hit-testing entirely.
  function attachEdgeClickHandlers(svgElement, board, onEdgeClick) {
    const existing = svgElement.querySelector('#edge-handlers');
    if (existing) existing.remove();

    const g = el('g', { id: 'edge-handlers' });
    board.graph.edges.forEach((edge, eIdx) => {
      const line = el('line', {
        x1: edge.x1, y1: edge.y1, x2: edge.x2, y2: edge.y2,
        stroke:           'rgba(0,0,0,0)',
        'stroke-width':   14,
        'stroke-linecap': 'round',
        style:            'cursor:pointer',
        'data-edge-idx':  eIdx,
      });
      line.addEventListener('mouseenter', () => line.setAttribute('stroke', 'rgba(255,255,255,0.5)'));
      line.addEventListener('mouseleave', () => line.setAttribute('stroke', 'rgba(0,0,0,0)'));
      line.addEventListener('click', (e) => { e.stopPropagation(); onEdgeClick(eIdx); });
      g.appendChild(line);
    });
    // Insert edge handlers BEFORE vertex handlers so vertex circles sit on top.
    // At every corner, three edge lines converge — without this, they bury the vertex hit area.
    const vHandlers = svgElement.querySelector('#vertex-handlers');
    if (vHandlers) svgElement.insertBefore(g, vHandlers);
    else           svgElement.appendChild(g);
  }

  // Briefly shows a red ✗ at (x, y) for 600ms then fades out — used to signal an invalid placement.
  function flashInvalid(svgElement, x, y) {
    const txt = el('text', {
      x, y,
      'text-anchor':      'middle',
      'dominant-baseline': 'middle',
      'font-size':        30,
      'font-weight':      'bold',
      fill:               '#cc0000',
      style:              'pointer-events:none',
    });
    txt.textContent = '✗';
    const anim = document.createElementNS(SVG_NS, 'animate');
    anim.setAttribute('attributeName', 'opacity');
    anim.setAttribute('from', '1');
    anim.setAttribute('to', '0');
    anim.setAttribute('dur', '0.6s');
    anim.setAttribute('fill', 'freeze');
    txt.appendChild(anim);
    svgElement.appendChild(txt);
    setTimeout(() => txt.remove(), 650);
  }

  const DIE_PIPS = {
    1: [[25, 25]],
    2: [[13, 13], [37, 37]],
    3: [[13, 13], [25, 25], [37, 37]],
    4: [[13, 13], [37, 13], [13, 37], [37, 37]],
    5: [[13, 13], [37, 13], [25, 25], [13, 37], [37, 37]],
    6: [[13, 13], [37, 13], [13, 25], [37, 25], [13, 37], [37, 37]],
  };

  // Draws two dice in the top-right corner of the SVG. Replaces any previous dice.
  function drawDice(svgElement, d1, d2) {
    const existing = svgElement.querySelector('#dice-layer');
    if (existing) existing.remove();

    const g = el('g', { id: 'dice-layer', 'pointer-events': 'none' });

    function drawOneDie(x, y, value) {
      g.appendChild(el('rect', {
        x, y, width: 50, height: 50, rx: 8,
        fill: 'white', stroke: '#333', 'stroke-width': 2,
      }));
      for (const [px, py] of (DIE_PIPS[value] || [])) {
        g.appendChild(el('circle', { cx: x + px, cy: y + py, r: 3, fill: '#222' }));
      }
    }

    drawOneDie(660, 55, d1);  // left die
    drawOneDie(720, 55, d2);  // right die, 10px gap
    svgElement.appendChild(g);
  }

  return { renderBoard, attachClickHandlers, drawGraphDebug, drawPieces, attachVertexClickHandlers, attachEdgeClickHandlers, flashInvalid, drawDice };
})();
