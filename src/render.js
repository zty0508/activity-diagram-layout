import { distance } from './geometry.js';
import { LANE_HEADER } from './model.js';

const NS = 'http://www.w3.org/2000/svg';

function shape(tag, attributes, text) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value);
  if (text !== undefined) el.textContent = text;
  return el;
}

function withTitle(el, label) {
  el.append(shape('title', {}, label));
  return el;
}

function target(kind, id, label) {
  return { 'data-kind': kind, 'data-id': id, 'aria-label': label };
}

function truncate(text, width, letterWidth) {
  const letters = Array.from(text);
  const max = Math.max(0, Math.floor(width / letterWidth));
  return letters.length > max ? (max > 0 ? letters.slice(0, max - 1).join('') + '…' : '') : text;
}

export const labelOf = (item) => item.label || item.id;

export function draw(drawing, diagram, selected, connector) {
  const isSelected = (kind, id) => selected?.kind === kind && selected.id === id;
  const lanes = document.createDocumentFragment();
  const edges = document.createDocumentFragment();
  const nodes = document.createDocumentFragment();
  const handles = document.createDocumentFragment();

  for (const lane of diagram.lanes) {
    const label = labelOf(lane);
    const group = shape('g', { class: isSelected('lane', lane.id) ? 'lane selected' : 'lane' });
    group.append(shape('rect', { class: 'lane-body', x: lane.x, y: lane.y + LANE_HEADER, width: lane.width,
      height: lane.height - LANE_HEADER }));
    const header = shape('rect', { class: 'lane-header', x: lane.x, y: lane.y, width: lane.width, height: LANE_HEADER,
      ...target('lane', lane.id, `Swimlane ${label}`) });
    group.append(withTitle(header, label));
    if (lane.width > 48) {
      group.append(shape('circle', { class: 'lane-dot', cx: lane.x + 17, cy: lane.y + 22, r: 3.2 }));
      group.append(shape('text', { class: 'lane-label', x: lane.x + 28, y: lane.y + 22,
        'dominant-baseline': 'middle' }, truncate(label, lane.width - 40, 7.5)));
    }
    lanes.append(group);
    const right = lane.x + lane.width;
    handles.append(withTitle(shape('line', { class: 'resize-handle', x1: right, x2: right, y1: lane.y,
      y2: lane.y + LANE_HEADER, ...target('resize', lane.id, `Resize ${label}`) }), `Drag to resize ${label}`));
  }

  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  for (const edge of diagram.edges) {
    const selectedEdge = isSelected('edge', edge.id);
    const label = edge.label || `${labelOf(byId.get(edge.source))} → ${labelOf(byId.get(edge.target))}`;
    const points = edge.route.map(({ x, y }) => `${x},${y}`).join(' ');
    const group = shape('g', { class: selectedEdge ? 'edge selected' : 'edge', ...target('edge', edge.id, label) });
    group.append(shape('polyline', { class: 'edge-line', points, 'marker-end': selectedEdge ? 'url(#arrow-selected)' : 'url(#arrow)' }));
    group.append(withTitle(shape('polyline', { class: 'edge-hit', points }), label));
    edges.append(group);
    if (!selectedEdge) continue;
    for (let index = 0; index < edge.route.length - 1; index++) {
      const a = edge.route[index];
      const b = edge.route[index + 1];
      if (distance(a, b) < 18) continue;
      handles.append(withTitle(shape('rect', { class: 'segment-handle', x: (a.x + b.x) / 2 - 4,
        y: (a.y + b.y) / 2 - 4, width: 8, height: 8, rx: 1,
        ...target('segment', edge.id, `Route segment ${index + 1}`), 'data-index': index }), 'Drag route segment'));
    }
    for (let index = 1; index < edge.route.length - 1; index++) {
      const point = edge.route[index];
      handles.append(withTitle(shape('circle', { class: selected.waypoint === index ? 'route-handle active' : 'route-handle',
        cx: point.x, cy: point.y, r: 5.5, ...target('waypoint', edge.id, `Waypoint ${index}`),
        'data-index': index }), 'Drag waypoint. Select it to remove it.'));
    }
  }

  for (const node of diagram.nodes) {
    const label = labelOf(node);
    const classes = ['node'];
    if (isSelected('node', node.id)) classes.push('selected');
    if (connector?.source === node.id) classes.push('source');
    const group = shape('g', { class: classes.join(' '), ...target('node', node.id, label) });
    group.append(withTitle(shape('rect', { x: node.x, y: node.y, width: node.width, height: node.height, rx: Math.min(6, node.height / 5) }), label));
    if (node.height >= 14) group.append(shape('text', { x: node.x + node.width / 2, y: node.y + node.height / 2,
      'text-anchor': 'middle', 'dominant-baseline': 'middle' }, truncate(label, node.width - 14, 7.1)));
    nodes.append(group);
  }

  if (!diagram.nodes.length) {
    const lane = diagram.lanes[0];
    nodes.append(shape('text', { class: 'empty-canvas', x: lane.x + lane.width / 2, y: lane.y + LANE_HEADER + 50,
      'text-anchor': 'middle' }, truncate('Add a node to get started', lane.width - 14, 7.1)));
  }
  drawing.replaceChildren(lanes, edges, nodes, handles);
}
