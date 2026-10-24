window.Render = (() => {
  const SVG_NS   = 'http://www.w3.org/2000/svg';
  const HEX_SIZE = 50;

  // Fill, lighter centre and rim colours for each tile type
  const TILE_COLORS = {
    forest:    { fill: '#2f8d3a', light: '#4fb34e', stroke: '#1f6427' },
    pasture:   { fill: '#86c440', light: '#a9dc63', stroke: '#5c9426' },
    fields:    { fill: '#efb02c', light: '#ffd05c', stroke: '#b98300' },
    hills:     { fill: '#dd5e2c', light: '#f3844f', stroke: '#a1401b' },
    mountains: { fill: '#9aa3ab', light: '#c2cad0', stroke: '#646d75' },
    desert:    { fill: '#e2cd96', light: '#f1e2b6', stroke: '#b1975c' },
  };
  const ROW_HEIGHT = 1.5 * HEX_SIZE;
  const HEX_WIDTH  = Math.sqrt(3) * HEX_SIZE;

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
  function hexPoints(cx, cy, size = HEX_SIZE) {
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const rad = (Math.PI / 180) * (60 * i + 30);
      pts.push(`${(cx + size * Math.cos(rad)).toFixed(2)},${(cy + size * Math.sin(rad)).toFixed(2)}`);
    }
    return pts.join(' ');
  }

  // One radial gradient per tile type: lighter in the middle, darker at the rim.
  function drawTileGradients(svg) {
    const defs = el('defs', {});
    for (const [type, c] of Object.entries(TILE_COLORS)) {
      const grad = el('radialGradient', { id: `tile-${type}`, cx: '50%', cy: '45%', r: '60%' });
      grad.appendChild(el('stop', { offset: '0%',   'stop-color': c.light }));
      grad.appendChild(el('stop', { offset: '100%', 'stop-color': c.fill }));
      defs.appendChild(grad);
    }
    svg.appendChild(defs);
  }

  // Draw a single hex tile polygon. Returns the element so click handlers can be attached.
  function drawTile(svg, pos, tileType, idx) {
    const c = TILE_COLORS[tileType];
    const poly = el('polygon', {
      points:          hexPoints(pos.x, pos.y, HEX_SIZE - 2),
      fill:            `url(#tile-${tileType})`,
      stroke:          c.stroke,
      'stroke-width':  3,
      'stroke-linejoin': 'round',
      class:           'hex-tile',
      'data-idx':      idx,
      style:           'cursor:pointer',
    });
    svg.appendChild(poly);
    return poly;
  }

  // Faint hex grid over the whole sea, lined up with the land tiles.
  function drawSeaGrid(svg, board, width, height) {
    const g  = el('g', { 'pointer-events': 'none' });
    const p0 = board.positions[0];
    const rowMin = Math.floor(-p0.y / ROW_HEIGHT) - 1;
    const rowMax = Math.ceil((height - p0.y) / ROW_HEIGHT) + 1;
    const colMin = Math.floor(-p0.x / (HEX_WIDTH / 2)) - 2;
    const colMax = Math.ceil((width - p0.x) / (HEX_WIDTH / 2)) + 2;
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        if ((r + c) % 2 !== 0) continue;
        g.appendChild(el('polygon', {
          points: hexPoints(p0.x + c * HEX_WIDTH / 2, p0.y + r * ROW_HEIGHT),
          fill: 'none', stroke: 'rgba(255, 255, 255, 0.07)', 'stroke-width': 1.5,
        }));
      }
    }
    svg.appendChild(g);
  }

  // Shallow-water glow and a sandy beach around every land tile. Overlapping
  // hexes merge into one coastline.
  function drawCoast(svg, board) {
    const glow  = el('g', { 'pointer-events': 'none' });
    const beach = el('g', { 'pointer-events': 'none' });
    for (const pos of board.positions) {
      glow.appendChild(el('polygon', {
        points: hexPoints(pos.x, pos.y, HEX_SIZE + 17), fill: '#4f9fe0', stroke: '#4f9fe0', 'stroke-width': 6,
        'stroke-linejoin': 'round',
      }));
      beach.appendChild(el('polygon', {
        points: hexPoints(pos.x, pos.y, HEX_SIZE + 7), fill: '#ead6a0', stroke: '#ead6a0', 'stroke-width': 3,
        'stroke-linejoin': 'round',
      }));
    }
    svg.appendChild(glow);
    svg.appendChild(beach);
  }

  const TILE_EMOJI = {
    forest: '🌲', hills: '🧱', pasture: '🐑', fields: '🌾', mountains: '⛰️', desert: '🌵',
  };

  const PORT_RESOURCE_EMOJI = { wood: '🪵', brick: '🧱', wheat: '🌾', wool: '🐑', ore: '⛏️' };

  function drawTileIcon(svgElement, pos, tileType) {
    const txt = el('text', {
      x:                  pos.x,
      y:                  pos.y - 25,
      'text-anchor':      'middle',
      'dominant-baseline': 'middle',
      'font-size':        24,
      'pointer-events':   'none',
    });
    txt.textContent = TILE_EMOJI[tileType] || '';
    svgElement.appendChild(txt);
  }

  // Number token: rounded cream square with a bold number and probability dots.
  function drawNumberToken(svg, pos, number) {
    const cx  = pos.x;
    const cy  = pos.y + 9;
    const red = number === 6 || number === 8;
    const ink = red ? '#c62828' : '#1f3d1f';

    svg.appendChild(el('rect', {
      x: cx - 17, y: cy - 17, width: 34, height: 34, rx: 7,
      fill:           '#f7f0dc',
      stroke:         'rgba(0, 0, 0, 0.28)',
      'stroke-width': 1.2,
      'pointer-events': 'none',
    }));

    // Number text
    const txt = el('text', {
      x:                   cx,
      y:                   cy - 3,
      'text-anchor':       'middle',
      'dominant-baseline': 'central',
      'font-size':         21,
      'font-weight':       '900',
      'font-family':       'Nunito, Arial, sans-serif',
      fill:                ink,
      'pointer-events':    'none',
    });
    txt.textContent = number;
    svg.appendChild(txt);

    // Probability dots
    const count   = DOT_COUNT[number] || 0;
    const dotR    = 1.7;
    const spacing = 4.2;
    const dotY    = cy + 10;
    const startX  = cx - ((count - 1) * spacing) / 2;
    for (let d = 0; d < count; d++) {
      svg.appendChild(el('circle', {
        cx:   startX + d * spacing,
        cy:   dotY,
        r:    dotR,
        fill: ink,
        'pointer-events': 'none',
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
      fill:          '#8c8c8c',
      stroke:        '#4a4a4a',
      'stroke-width': 1.5,
      'pointer-events': 'none',
    }));

    // Body
    svg.appendChild(el('ellipse', {
      cx,
      cy:            cy,
      rx:            9,
      ry:            10,
      fill:          '#8c8c8c',
      stroke:        '#4a4a4a',
      'stroke-width': 1.5,
      'pointer-events': 'none',
    }));
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  // Wipes the SVG and redraws the complete board from a board object
  // produced by window.Board.generateBoard().
  function renderBoard(svgElement, board) {
    svgElement.innerHTML = '';
    const { positions, tiles, numbers, robber } = board;
    const width  = board.view ? board.view.width  : 800;
    const height = board.view ? board.view.height : 800;
    svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);

    // 0. Sea grid, then the shallow water and beaches around the land
    drawTileGradients(svgElement);
    drawSeaGrid(svgElement, board, width, height);
    drawCoast(svgElement, board);

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

  // Draws port markers: dashed anchor lines + ship icon + rate label.
  // Called right after renderBoard (which wipes the SVG), so appending is safe — no
  // groups exist yet that would cover the port layer.
  function drawPorts(svgElement, board) {
    const existing = svgElement.querySelector('#ports-layer');
    if (existing) existing.remove();
    if (!board.ports || board.ports.length === 0) return;

    const g = el('g', { id: 'ports-layer', 'pointer-events': 'none' });

    for (const port of board.ports) {
      const { iconX, iconY, vertexA, vertexB, type } = port;
      const vA = board.graph.vertices[vertexA];
      const vB = board.graph.vertices[vertexB];

      // Wooden docks from the two port corners out towards the ship
      for (const v of [vA, vB]) {
        g.appendChild(el('line', {
          x1: v.x, y1: v.y,
          x2: v.x + (iconX - v.x) * 0.62, y2: v.y + (iconY - v.y) * 0.62,
          stroke:             '#b5803f',
          'stroke-width':     6,
          'stroke-dasharray': '3,2',
        }));
      }

      // Ship on a white sail-coloured disc
      g.appendChild(el('circle', {
        cx: iconX, cy: iconY, r: 17,
        fill: '#fbf7ec', stroke: '#c9b48a', 'stroke-width': 1.5,
      }));
      const ship = el('text', {
        x: iconX, y: iconY - 3,
        'text-anchor':       'middle',
        'dominant-baseline': 'middle',
        'font-size':         type === 'any' ? 16 : 14,
      });
      ship.textContent = type === 'any' ? '⛵' : PORT_RESOURCE_EMOJI[type];
      g.appendChild(ship);

      // Rate under the icon
      const label = el('text', {
        x: iconX, y: iconY + 10,
        'text-anchor':       'middle',
        'dominant-baseline': 'middle',
        'font-size':         9,
        'font-weight':       '900',
        'font-family':       'Nunito, Arial, sans-serif',
        fill:                '#4a3b22',
      });
      label.textContent = type === 'any' ? '3:1' : '2:1';
      g.appendChild(label);
    }

    svgElement.appendChild(g);
  }

  // Soft glowing circles on the corners/edges where the player can build right now.
  // Drawn under the click targets so clicks still reach them.
  function drawHighlights(svgElement, board, spots) {
    const existing = svgElement.querySelector('#highlight-layer');
    if (existing) existing.remove();
    if (!spots || (!spots.vertices.length && !spots.edges.length)) return;

    const g = el('g', { id: 'highlight-layer', 'pointer-events': 'none' });
    for (const vIdx of spots.vertices) {
      const v = board.graph.vertices[vIdx];
      g.appendChild(el('circle', { cx: v.x, cy: v.y, r: 11, class: 'build-spot' }));
    }
    for (const eIdx of spots.edges) {
      const e = board.graph.edges[eIdx];
      g.appendChild(el('circle', { cx: (e.x1 + e.x2) / 2, cy: (e.y1 + e.y2) / 2, r: 8, class: 'build-spot' }));
    }
    const handlers = svgElement.querySelector('#edge-handlers') || svgElement.querySelector('#vertex-handlers');
    if (handlers) svgElement.insertBefore(g, handlers);
    else          svgElement.appendChild(g);
  }

  return { renderBoard, attachClickHandlers, drawGraphDebug, drawPieces, drawPorts, attachVertexClickHandlers, attachEdgeClickHandlers, flashInvalid, drawHighlights };
})();
