import { LANE_HEADER, LANE_PADDING, NODE_HEIGHT, NODE_WIDTH, validateDiagram } from './model.js';
import { layerGraph, laneOrders, orderRows } from './layers.js';
import { naiveRoutes, smartRoutes } from './routing.js';
import { measure } from './metrics.js';

const OUTER_X = 42;
const OUTER_Y = 24;
const FIRST_ROW_GAP = 35;
const ROW_GAP = 60;
const COLUMN_GAP = 32;
const MIN_LANE_WIDTH = 214;
const MIN_LANE_HEIGHT = 280;

function place(graph, lanes, rows, naive, feedback) {
  const widths = new Map(lanes.map((lane) => [lane.id, Math.max(MIN_LANE_WIDTH, lane.width ?? 0)]));
  const nodeById = new Map();
  const ranks = new Map();
  const rowBounds = new Map();
  const cells = rows.map((row) => {
    const groups = new Map();
    for (const vertex of row) {
      if (!vertex.node) continue;
      const node = { ...vertex.node, width: vertex.node.width ?? NODE_WIDTH, height: vertex.node.height ?? NODE_HEIGHT };
      if (!groups.has(node.laneId)) groups.set(node.laneId, []);
      groups.get(node.laneId).push(node);
    }
    for (const [laneId, nodes] of groups) {
      widths.set(laneId, Math.max(widths.get(laneId), groupWidth(nodes) + LANE_PADDING * 2));
    }
    return groups;
  });
  let x = OUTER_X;
  const placedLanes = lanes.map((lane) => {
    const width = widths.get(lane.id);
    const placed = { ...lane, x, y: OUTER_Y, width };
    x += width;
    return placed;
  });
  const laneById = new Map(placedLanes.map((lane) => [lane.id, lane]));
  let y = OUTER_Y + LANE_HEADER + FIRST_ROW_GAP;
  cells.forEach((groups, rank) => {
    let height = 0;
    for (const nodes of groups.values()) {
      for (const node of nodes) height = Math.max(height, node.height);
    }
    if (!height) {
      y += 22;
      return;
    }
    rowBounds.set(rank, { top: y, bottom: y + height });
    for (const [laneId, nodes] of groups) {
      const lane = laneById.get(laneId);
      let left = lane.x + (lane.width - groupWidth(nodes)) / 2;
      for (const node of nodes) {
        node.x = left;
        node.y = y + (height - node.height) / 2;
        left += node.width + COLUMN_GAP;
        nodeById.set(node.id, node);
        ranks.set(node.id, rank);
      }
    }
    y += height + ROW_GAP;
  });
  const laneHeight = placedLanes.reduce((height, lane) => Math.max(height, lane.height ?? 0),
    Math.max(MIN_LANE_HEIGHT, y - OUTER_Y - ROW_GAP + 46));
  for (const lane of placedLanes) lane.height = laneHeight;
  const diagram = {
    ...graph,
    lanes: placedLanes,
    nodes: graph.nodes.map(({ id }) => nodeById.get(id)),
    edges: graph.edges.map((edge) => ({ ...edge })),
    layout: { ...graph.layout, width: x + OUTER_X, height: OUTER_Y * 2 + laneHeight, manual: false },
  };
  const routes = naive ? naiveRoutes(diagram, feedback) : smartRoutes(diagram, ranks, rowBounds, feedback);
  diagram.edges.forEach((edge, index) => { edge.route = routes[index]; });
  return diagram;
}

function groupWidth(nodes) {
  return nodes.reduce((sum, node) => sum + node.width, COLUMN_GAP * (nodes.length - 1));
}

function graphForLayout(input) {
  const graph = validateDiagram(input);
  if (!graph.layout) return graph;
  // Saved lane dimensions reflect a previous arrangement. Node dimensions remain content constraints.
  graph.lanes = graph.lanes.map(({ x, y, width, height, ...lane }) => lane);
  return graph;
}

export function naiveLayout(input) {
  const graph = graphForLayout(input);
  const layered = layerGraph(graph);
  return place(graph, graph.lanes, layered.rows, true, layered.feedback);
}

export function qualityScore(metrics) {
  return [metrics.overlaps, metrics.obstructions, metrics.crossings, metrics.length + 14 * metrics.bends];
}

function isBetter(a, b) {
  return a.some((value, index) => value < b[index] && a.slice(0, index).every((entry, i) => entry === b[i]));
}

export function optimizeLayout(input) {
  const graph = graphForLayout(input);
  const layered = layerGraph(graph);
  const baseline = place(graph, graph.lanes, layered.rows, true, layered.feedback);
  const naive = measure(baseline);
  const routed = place(graph, graph.lanes, layered.rows, false, layered.feedback);
  let diagram = routed;
  let score = qualityScore(measure(diagram));
  const configurations = laneOrders(graph).map((lanes) => ({ lanes, ...orderRows(layered, lanes) }));
  const original = configurations[0];
  const alternatives = configurations.slice(1).sort((a, b) => a.cost - b.cost);
  for (const { lanes, rows } of [original, ...alternatives.slice(0, graph.edges.length > 100 ? 1 : 4)]) {
    const candidate = place(graph, lanes, rows, false, layered.feedback);
    const candidateScore = qualityScore(measure(candidate));
    if (isBetter(candidateScore, score)) {
      diagram = candidate;
      score = candidateScore;
    }
  }
  const layout = { ...diagram.layout, baseline: naive };
  return { diagram: { ...diagram, layout }, naive, smart: measure(diagram) };
}
