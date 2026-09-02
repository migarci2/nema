/* nema vault: the learning graph.
 *
 * A deterministic SVG. Concepts are square nodes coloured by their best band,
 * laid out in columns by prerequisite depth and joined by thin curves. No
 * physics, no layout randomness, no animation beyond the 150 ms colour
 * transition that brand.css puts on every node. Given the same registry and
 * the same state it draws exactly the same picture, every time.
 *
 * Labels sit centred under their node, and edges are drawn under both, with a
 * navy halo on the text so a line never runs through a word.
 */

import { bestBand } from '/shared/inference.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const NODE = 11;          /* node square, in viewBox units */
const COL_W = 200;        /* horizontal pitch between depth columns */
const ROW_H = 28;         /* vertical pitch between nodes in a column */
const PAD_X = 96;         /* room for the widest label on the outer columns */
const PAD_Y = 14;
const LABEL_DY = 13;      /* label baseline below the node centre */

/**
 * Prerequisite depth for every concept: 0 for a root, otherwise one more than
 * the deepest prerequisite. Cycles resolve to 0 rather than recursing forever.
 *
 * @param {Array<{id: string, prereqs?: string[]}>} concepts
 * @returns {Map<string, number>}
 */
export function depthMap(concepts) {
  const byId = new Map(concepts.map((entry) => [entry.id, entry]));
  const depths = new Map();

  const visit = (id, seen) => {
    if (depths.has(id)) return depths.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const entry = byId.get(id);
    const prereqs = (entry && Array.isArray(entry.prereqs) ? entry.prereqs : []).filter((p) => byId.has(p));
    const depth = prereqs.length === 0
      ? 0
      : 1 + Math.max(...prereqs.map((p) => visit(p, new Set(seen))));
    depths.set(id, depth);
    return depth;
  };

  for (const entry of concepts) visit(entry.id, new Set());
  return depths;
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

/**
 * Draw the graph into `container`.
 *
 * @param {Element} container
 * @param {object} options
 * @param {Array} options.concepts   the concept registry
 * @param {object} options.state     derived learner state
 * @param {(conceptId: string|null) => void} [options.onSelect] hover and focus
 * @returns {{ layout: Map<string, {x: number, y: number, depth: number}> }}
 */
export function renderGraph(container, { concepts, state, onSelect } = {}) {
  container.textContent = '';

  const registry = Array.isArray(concepts) ? concepts : [];
  if (registry.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'n-empty';
    empty.textContent = 'The concept registry did not load';
    container.appendChild(empty);
    return { layout: new Map() };
  }

  const depths = depthMap(registry);
  const columns = new Map();
  for (const entry of [...registry].sort((a, b) => a.id.localeCompare(b.id))) {
    const depth = depths.get(entry.id) || 0;
    if (!columns.has(depth)) columns.set(depth, []);
    columns.get(depth).push(entry);
  }

  const depthKeys = [...columns.keys()].sort((a, b) => a - b);
  const rows = Math.max(...depthKeys.map((depth) => columns.get(depth).length));
  const width = PAD_X * 2 + (depthKeys.length - 1) * COL_W;
  const height = PAD_Y * 2 + (rows - 1) * ROW_H + LABEL_DY;

  const layout = new Map();
  depthKeys.forEach((depth, columnIndex) => {
    const list = columns.get(depth);
    /* Centre short columns against the tallest one, so the drawing reads as a
     * ladder rather than a ragged left edge. The offset is whole rows: half a
     * row would put every long horizontal edge exactly on a label baseline in
     * the columns it passes through. */
    const offset = Math.round((rows - list.length) / 2);
    list.forEach((entry, rowIndex) => {
      layout.set(entry.id, {
        x: PAD_X + columnIndex * COL_W,
        y: PAD_Y + (offset + rowIndex) * ROW_H,
        depth
      });
    });
  });

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'group',
    'aria-label': `Learning graph, ${registry.length} concepts in ${depthKeys.length} prerequisite levels`
  });

  const edgeLayer = el('g', { 'aria-hidden': 'true' });
  const nodeLayer = el('g');
  svg.append(edgeLayer, nodeLayer);

  const edgesByConcept = new Map();
  const rememberEdge = (id, line) => {
    if (!edgesByConcept.has(id)) edgesByConcept.set(id, []);
    edgesByConcept.get(id).push(line);
  };

  for (const entry of registry) {
    const to = layout.get(entry.id);
    if (!to) continue;
    for (const prereq of Array.isArray(entry.prereqs) ? entry.prereqs : []) {
      const from = layout.get(prereq);
      if (!from) continue;
      /* A curve out of the source and into the target, both tangents
       * horizontal. Orthogonal elbows drew long straight runs along the row
       * grid, which turned the whole picture into a stack of nested boxes and
       * laid a rule across the labels they passed. A curve leaves the row as
       * soon as it starts, so it crosses a word at an angle instead. */
      const startX = from.x + NODE / 2 + 1;
      const endX = to.x - NODE / 2 - 1;
      const bend = Math.max(28, (endX - startX) * 0.45);
      const line = el('path', {
        class: 'n-graph__edge',
        d: `M ${startX} ${from.y} C ${(startX + bend).toFixed(1)} ${from.y}, ${(endX - bend).toFixed(1)} ${to.y}, ${endX} ${to.y}`
      });
      edgeLayer.appendChild(line);
      rememberEdge(entry.id, line);
      rememberEdge(prereq, line);
    }
  }

  const setActive = (conceptId) => {
    for (const list of edgesByConcept.values()) {
      for (const line of list) line.classList.remove('n-graph__edge--active');
    }
    if (conceptId && edgesByConcept.has(conceptId)) {
      for (const line of edgesByConcept.get(conceptId)) line.classList.add('n-graph__edge--active');
    }
    if (typeof onSelect === 'function') onSelect(conceptId);
  };

  for (const entry of registry) {
    const point = layout.get(entry.id);
    if (!point) continue;
    const abilities = (state && state[entry.id]) || null;
    const band = abilities ? bestBand(abilities) : 'unknown';
    const due = abilities
      ? Object.values(abilities).some((value) => value && value.reviewDue === true)
      : false;

    const bandList = abilities
      ? Object.entries(abilities).map(([ability, value]) => `${ability} ${value.band}`).join(', ')
      : 'no evidence yet';

    const group = el('g', {
      class: 'n-graph__group',
      tabindex: '0',
      role: 'button',
      'aria-label': `${entry.title}, best band ${band}. ${bandList}${due ? '. Review due' : ''}`
    });

    const title = el('title');
    title.textContent = `${entry.title}: ${bandList}`;
    group.appendChild(title);

    group.appendChild(el('rect', {
      class: `n-graph__node n-graph__node--${band}`,
      x: point.x - NODE / 2,
      y: point.y - NODE / 2,
      width: NODE,
      height: NODE
    }));

    if (due) {
      group.appendChild(el('rect', {
        class: 'v-graph__due',
        x: point.x + NODE / 2 - 1,
        y: point.y - NODE / 2 - 5,
        width: 5,
        height: 5
      }));
    }

    const label = el('text', {
      class: band === 'unknown' ? 'n-graph__label n-graph__label--dim' : 'n-graph__label',
      x: point.x,
      y: point.y + LABEL_DY
    });
    /* The graph is read by a learner, so a node is named the way the registry
     * names it, not the way it is keyed. Contract section 26. */
    label.textContent = entry.title;
    group.appendChild(label);

    group.addEventListener('mouseenter', () => setActive(entry.id));
    group.addEventListener('mouseleave', () => setActive(null));
    group.addEventListener('focus', () => setActive(entry.id));
    group.addEventListener('blur', () => setActive(null));

    nodeLayer.appendChild(group);
  }

  container.appendChild(svg);
  return { layout };
}
