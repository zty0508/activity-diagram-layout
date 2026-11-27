export const VERSION = 1;
export const NODE_WIDTH = 148;
export const NODE_HEIGHT = 44;
export const LANE_HEADER = 44;
export const LANE_PADDING = 20;

const own = (object, key) => Object.hasOwn(object, key);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && value.trim().length > 0;
const number = (value) => Number.isFinite(value) && Math.abs(value) <= 1e9;
const positive = (value) => number(value) && value > 0;

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}

function entities(array, kind, validate) {
  requireThat(Array.isArray(array), `${kind} must be an array.`);
  const ids = new Set();
  for (const item of array) {
    requireThat(record(item) && id(item.id), `Each ${kind} entry needs a nonempty string ID.`);
    requireThat(!ids.has(item.id), `Duplicate ${kind} ID "${item.id}".`);
    ids.add(item.id);
    if (own(item, 'label')) requireThat(typeof item.label === 'string', `"${item.id}" needs a text label.`);
    validate(item);
  }
  return ids;
}

function validateSize(item, full) {
  for (const key of ['width', 'height']) {
    if (full || own(item, key)) requireThat(positive(item[key]), `"${item.id}" needs a positive ${key}.`);
  }
}

function validatePosition(item, full) {
  for (const key of ['x', 'y']) {
    if (full) requireThat(number(item[key]) && item[key] >= 0, `"${item.id}" needs a nonnegative ${key}.`);
    else requireThat(!own(item, key), 'Partial layout detected. Supply the complete layout or omit coordinates and routes.');
  }
}

export function validateDiagram(input) {
  requireThat(record(input), 'The diagram must be a JSON object.');
  requireThat(!own(input, 'version') || input.version === VERSION, 'Unsupported diagram version. Expected version 1.');
  requireThat(!own(input, 'title') || typeof input.title === 'string', 'The diagram title must be text.');

  const full = own(input, 'layout');
  if (full) {
    requireThat(record(input.layout) && positive(input.layout.width) && positive(input.layout.height),
      'Layout needs positive width and height.');
    if (own(input.layout, 'manual')) requireThat(typeof input.layout.manual === 'boolean', 'Layout manual flag must be true or false.');
  }

  const laneIds = entities(input.lanes, 'lane', (lane) => {
    validateSize(lane, full);
    validatePosition(lane, full);
    if (full) requireThat(lane.height > LANE_HEADER, `Lane "${lane.id}" is shorter than its header.`);
  });
  requireThat(laneIds.size > 0, 'At least one swimlane is required.');
  const lanes = new Map(input.lanes.map((lane) => [lane.id, lane]));
  if (full) {
    const first = input.lanes[0];
    let right = 0;
    for (const lane of input.lanes) {
      requireThat(lane.x >= right && lane.y === first.y && lane.height === first.height,
        'Swimlanes must be ordered left to right, with aligned tops and bottoms.');
      requireThat(lane.x + lane.width <= input.layout.width && lane.y + lane.height <= input.layout.height,
        `Lane "${lane.id}" lies outside the layout.`);
      right = lane.x + lane.width;
    }
  }

  const nodeIds = entities(input.nodes, 'node', (node) => {
    const lane = lanes.get(node.laneId);
    requireThat(lane, `Node "${node.id}" refers to an unknown swimlane.`);
    validateSize(node, full);
    validatePosition(node, full);
    if (full) requireThat(node.x >= lane.x && node.x + node.width <= lane.x + lane.width &&
      node.y >= lane.y + LANE_HEADER && node.y + node.height <= lane.y + lane.height,
    `Node "${node.id}" lies outside its swimlane body.`);
  });

  entities(input.edges, 'edge', (edge) => {
    requireThat(nodeIds.has(edge.source) && nodeIds.has(edge.target), `Edge "${edge.id}" refers to an unknown node.`);
    if (full) requireThat(Array.isArray(edge.route) && edge.route.length >= 2 &&
      edge.route.every((point) => record(point) && number(point.x) && number(point.y)),
    `Edge "${edge.id}" needs a route with at least two finite points.`);
    else requireThat(!own(edge, 'route'), 'Partial layout detected. Supply the complete layout or omit coordinates and routes.');
  });

  return { version: VERSION, title: 'Untitled diagram', ...structuredClone(input) };
}

export function parseDiagram(json) {
  let input;
  try {
    input = JSON.parse(json);
  } catch {
    throw new Error('This file does not contain valid JSON.');
  }
  return validateDiagram(input);
}
