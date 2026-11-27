import { boundaryPoint, center, clamp, distance, samePoint } from './geometry.js';
import { LANE_HEADER, LANE_PADDING, NODE_HEIGHT, NODE_WIDTH } from './model.js';

export function blankDiagram(title = 'Untitled diagram') {
  return {
    version: 1,
    title,
    lanes: [{ id: 'lane-1', label: 'Activity', x: 42, y: 24, width: 260, height: 400 }],
    nodes: [],
    edges: [],
    layout: { width: 344, height: 448, manual: false },
  };
}

export class History {
  constructor(diagram) {
    this.reset(diagram);
  }

  reset(diagram) {
    this.current = diagram;
    this.past = [];
    this.future = [];
  }

  commit(diagram) {
    if (diagram === this.current) return false;
    this.past.push(this.current);
    if (this.past.length > 100) this.past.shift();
    this.current = diagram;
    this.future = [];
    return true;
  }

  undo() {
    if (!this.past.length) return;
    this.future.push(this.current);
    this.current = this.past.pop();
  }

  redo() {
    if (!this.future.length) return;
    this.past.push(this.current);
    this.current = this.future.pop();
  }
}

function edited(diagram, changes, topology = false) {
  const layout = { ...diagram.layout, ...changes.layout, manual: true };
  if (topology) delete layout.baseline;
  return { ...diagram, ...changes, layout };
}

function nextId(items, prefix) {
  const ids = new Set(items.map((item) => item.id));
  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}

function initialRoute(source, target) {
  if (source.id !== target.id) {
    return [boundaryPoint(source, center(target)), boundaryPoint(target, center(source), 'top')];
  }
  const c = center(source);
  const right = source.x + source.width + 20;
  return [{ x: c.x, y: source.y + source.height }, { x: c.x, y: source.y + source.height + 16 },
    { x: right, y: source.y + source.height + 16 }, { x: right, y: c.y }, { x: source.x + source.width, y: c.y }];
}

function stretchLanes(diagram, height) {
  const current = diagram.lanes[0].height;
  return {
    lanes: diagram.lanes.map((lane) => ({ ...lane, height })),
    layout: { height: diagram.layout.height + height - current },
  };
}

export function addLane(diagram, label) {
  const last = diagram.lanes.at(-1);
  const lane = { id: nextId(diagram.lanes, 'lane'), label, x: last.x + last.width,
    y: last.y, width: 240, height: last.height };
  return { diagram: edited(diagram, { lanes: [...diagram.lanes, lane], layout: { width: diagram.layout.width + lane.width } }, true),
    id: lane.id };
}

export function addNode(diagram, laneId, label) {
  const lane = diagram.lanes.find((entry) => entry.id === laneId);
  if (!lane) return { diagram };
  const width = Math.min(NODE_WIDTH, lane.width - Math.min(24, lane.width / 4));
  const x = lane.x + (lane.width - width) / 2;
  const occupied = diagram.nodes.filter((node) => node.laneId === laneId &&
    node.x + node.width + 12 > x && x + width + 12 > node.x).sort((a, b) => a.y - b.y);
  let y = lane.y + LANE_HEADER + LANE_PADDING;
  for (const node of occupied) {
    if (y + NODE_HEIGHT + 12 <= node.y) break;
    y = Math.max(y, node.y + node.height + 12);
  }
  const node = { id: nextId(diagram.nodes, 'node'), laneId, label, x, y, width, height: NODE_HEIGHT };
  const height = y + NODE_HEIGHT + LANE_PADDING - lane.y;
  const expanded = height > lane.height ? stretchLanes(diagram, height) : {};
  return { diagram: edited(diagram, { ...expanded, nodes: [...diagram.nodes, node] }, true), id: node.id };
}

export function addEdge(diagram, sourceId, targetId) {
  const source = diagram.nodes.find((node) => node.id === sourceId);
  const target = diagram.nodes.find((node) => node.id === targetId);
  if (!source || !target) return { diagram };
  const edge = { id: nextId(diagram.edges, 'edge'), source: sourceId, target: targetId, route: initialRoute(source, target) };
  return { diagram: edited(diagram, { edges: [...diagram.edges, edge] }, true), id: edge.id };
}

export function removeSelection(diagram, selection) {
  if (selection?.kind === 'edge') {
    return edited(diagram, { edges: diagram.edges.filter((edge) => edge.id !== selection.id) }, true);
  }
  if (selection?.kind === 'node') {
    return edited(diagram, {
      nodes: diagram.nodes.filter((node) => node.id !== selection.id),
      edges: diagram.edges.filter((edge) => edge.source !== selection.id && edge.target !== selection.id),
    }, true);
  }
  return diagram;
}

export function moveNode(diagram, id, x, y) {
  const source = diagram.nodes.find((node) => node.id === id);
  const lane = diagram.lanes.find((entry) => entry.id === source.laneId);
  const moved = { ...source, x: clamp(x, lane.x, lane.x + lane.width - source.width),
    y: clamp(y, lane.y + LANE_HEADER, lane.y + lane.height - source.height) };
  if (samePoint(moved, source)) return diagram;
  const nodes = diagram.nodes.map((node) => node.id === id ? moved : node);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = diagram.edges.map((edge) => {
    if (edge.source !== id && edge.target !== id) return edge;
    if (edge.route.length < 3) return { ...edge, route: initialRoute(byId.get(edge.source), byId.get(edge.target)) };
    const route = [...edge.route];
    if (edge.source === id) route[0] = boundaryPoint(moved, route[1]);
    if (edge.target === id) route[route.length - 1] = boundaryPoint(moved, route.at(-2), 'top');
    return { ...edge, route };
  });
  return edited(diagram, { nodes, edges });
}

function applyLanePositions(diagram, ordered) {
  const oldById = new Map(diagram.lanes.map((lane) => [lane.id, lane]));
  let x = diagram.lanes[0].x;
  const shifts = new Map();
  const lanes = ordered.map((lane, index) => {
    const old = oldById.get(lane.id);
    shifts.set(lane.id, x - old.x);
    const positioned = { ...lane, x };
    const oldSlot = diagram.lanes[index];
    const next = diagram.lanes[index + 1];
    x += lane.width + (next ? next.x - oldSlot.x - oldSlot.width : 0);
    return positioned;
  });
  const byNode = new Map(diagram.nodes.map((node) => [node.id, node.laneId]));
  const nodes = diagram.nodes.map((node) => ({ ...node, x: node.x + shifts.get(node.laneId) }));
  const previousRight = diagram.lanes.at(-1).x + diagram.lanes.at(-1).width;
  const edges = diagram.edges.map((edge) => {
    const route = edge.route.map((point, index) => {
      let laneId;
      if (index === 0) laneId = byNode.get(edge.source);
      else if (index === edge.route.length - 1) laneId = byNode.get(edge.target);
      else laneId = diagram.lanes.find((lane) => point.x >= lane.x && point.x < lane.x + lane.width)?.id;
      const shift = laneId ? shifts.get(laneId) : point.x >= previousRight ? x - previousRight : 0;
      return { ...point, x: point.x + shift };
    });
    return { ...edge, route };
  });
  return edited(diagram, { lanes, nodes, edges, layout: { width: diagram.layout.width + x - previousRight } });
}

export function reorderLane(diagram, id, index) {
  const from = diagram.lanes.findIndex((lane) => lane.id === id);
  if (from < 0 || from === index || index < 0 || index >= diagram.lanes.length) return diagram;
  const lanes = [...diagram.lanes];
  const [lane] = lanes.splice(from, 1);
  lanes.splice(index, 0, lane);
  return applyLanePositions(diagram, lanes);
}

export function resizeLane(diagram, id, width) {
  const lane = diagram.lanes.find((item) => item.id === id);
  if (!lane || !Number.isFinite(width)) return diagram;
  const min = diagram.nodes.filter((node) => node.laneId === id)
    .reduce((right, node) => Math.max(right, node.x + node.width - lane.x), Math.min(110, lane.width));
  const size = clamp(width, min, Math.max(lane.width, 200000));
  if (size === lane.width) return diagram;
  return applyLanePositions(diagram, diagram.lanes.map((item) => item.id === id ? { ...item, width: size } : item));
}

export function resizeHeight(diagram, height) {
  if (!Number.isFinite(height)) return diagram;
  const lane = diagram.lanes[0];
  const min = diagram.nodes.reduce((bottom, node) => Math.max(bottom, node.y + node.height - lane.y), LANE_HEADER + 36);
  const size = clamp(height, min, Math.max(lane.height, 200000));
  return size === lane.height ? diagram : edited(diagram, stretchLanes(diagram, size));
}

export function setLabel(diagram, selection, value) {
  const key = { lane: 'lanes', node: 'nodes', edge: 'edges' }[selection.kind];
  if (!key) return diagram;
  const item = diagram[key].find(({ id }) => selection.id === id);
  if (!item || (item.label ?? '') === value) return diagram;
  return edited(diagram, { [key]: diagram[key].map((item) => item.id === selection.id ? { ...item, label: value } : item) });
}

function editRoute(diagram, id, transform) {
  const edge = diagram.edges.find((item) => item.id === id);
  if (!edge) return diagram;
  const route = transform(edge.route);
  if (route === edge.route) return diagram;
  return edited(diagram, { edges: diagram.edges.map((item) => item.id === id ? { ...item, route } : item) });
}

export function addWaypoint(diagram, id, index, point) {
  return editRoute(diagram, id, (route) => {
    let segment = index;
    if (segment === undefined) {
      segment = 0;
      let best = -1;
      for (let i = 0; i < route.length - 1; i++) {
        const length = distance(route[i], route[i + 1]);
        if (length > best) {
          best = length;
          segment = i;
        }
      }
    }
    const a = route[segment];
    const b = route[segment + 1];
    if (!a || !b) return route;
    const waypoint = point ?? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return [...route.slice(0, segment + 1), waypoint, ...route.slice(segment + 1)];
  });
}

export function removeWaypoint(diagram, id, index) {
  return editRoute(diagram, id, (route) => index > 0 && index < route.length - 1
    ? route.filter((_, i) => i !== index) : route);
}

export function moveWaypoint(diagram, id, index, point) {
  return editRoute(diagram, id, (route) => index > 0 && index < route.length - 1 && !samePoint(route[index], point)
    ? route.map((value, i) => i === index ? point : value) : route);
}

export function moveSegment(diagram, id, index, dx, dy) {
  if (!dx && !dy) return diagram;
  return editRoute(diagram, id, (route) => {
    const a = route[index];
    const b = route[index + 1];
    if (!a || !b) return route;
    // A terminal segment gains a waypoint so its attachment stays fixed.
    return [...route.slice(0, index || 1), { x: a.x + dx, y: a.y + dy },
      { x: b.x + dx, y: b.y + dy }, ...route.slice(Math.min(index + 2, route.length - 1))];
  });
}
