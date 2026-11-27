import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { addEdge, addLane, addNode, addWaypoint, blankDiagram, History, moveNode, moveSegment, moveWaypoint,
  removeSelection, removeWaypoint, reorderLane, resizeHeight, resizeLane } from '../src/editor.js';
import { optimizeLayout } from '../src/layout.js';
import { parseDiagram, validateDiagram } from '../src/model.js';
import { DiagramStorage, exportDiagram, importDiagram } from '../src/persistence.js';

class MemoryStorage {
  entries = new Map();
  getItem(key) { return this.entries.get(key) ?? null; }
  setItem(key, value) { this.entries.set(key, String(value)); }
}

function editedDiagram() {
  let diagram = blankDiagram('Edited activity');
  let result = addLane(diagram, 'Review');
  const second = result.id;
  result = addNode(result.diagram, diagram.lanes[0].id, 'Create');
  const source = result.id;
  result = addNode(result.diagram, second, 'Review');
  const target = result.id;
  result = addEdge(result.diagram, source, target);
  diagram = addWaypoint(result.diagram, result.id);
  diagram = moveWaypoint(diagram, result.id, 1, { x: 180, y: 212 });
  diagram = moveNode(diagram, target, 355, 250);
  diagram = reorderLane(diagram, second, 0);
  diagram = resizeLane(diagram, second, 231.5);
  return { diagram, source, target, edge: result.id };
}

test('node creation, movement, deletion and attached edges keep stable IDs', () => {
  const { diagram, source, target, edge } = editedDiagram();
  assert.deepEqual(diagram.nodes.map(({ id }) => id), [source, target]);
  const route = diagram.edges[0].route;
  assert.equal(diagram.edges[0].id, edge);
  const moved = moveNode(diagram, source, 1e4, -1e4);
  assert.notDeepEqual(moved.edges[0].route[0], route[0]);
  assert.deepEqual(moved.edges[0].route.slice(1), route.slice(1));
  const lane = moved.lanes.find(({ id }) => id === moved.nodes[0].laneId);
  assert.equal(moved.nodes[0].x + moved.nodes[0].width, lane.x + lane.width);
  assert.deepEqual(validateDiagram(moved), moved);
  assert.equal(removeSelection(moved, { kind: 'edge', id: edge }).nodes.length, 2);
  const removed = removeSelection(moved, { kind: 'node', id: target });
  assert.equal(removed.nodes.length, 1);
  assert.equal(removed.edges.length, 0);
});

test('resizing and reordering lanes preserve local node coordinates and edge anchors', () => {
  const { diagram, target } = editedDiagram();
  const node = diagram.nodes.find(({ id }) => id === target);
  const first = diagram.lanes[0];
  const reordered = reorderLane(diagram, first.id, 1);
  const shifted = reordered.nodes.find(({ id }) => id === target);
  assert.equal(shifted.x - reordered.lanes[1].x, node.x - first.x);
  assert.equal(shifted.laneId, node.laneId);
  const before = diagram.edges[0].route.at(-1);
  const after = reordered.edges[0].route.at(-1);
  assert.equal(after.x - shifted.x, before.x - node.x);
  const resized = resizeHeight(reordered, 310.5);
  assert.ok(resized.lanes.every((lane) => lane.height === resized.lanes[0].height));
  assert.deepEqual(resized.nodes, reordered.nodes);
  assert.deepEqual(validateDiagram(resized), resized);
});

test('segment changes preserve endpoints and keep explicit waypoints removable', () => {
  const { diagram, edge } = editedDiagram();
  const original = diagram.edges[0].route;
  const shifted = moveSegment(diagram, edge, 0, -17, 28);
  const route = shifted.edges[0].route;
  assert.deepEqual(route[0], original[0]);
  assert.deepEqual(route[1], { x: original[0].x - 17, y: original[0].y + 28 });
  assert.deepEqual(route.at(-1), original.at(-1));
  const removed = removeWaypoint(shifted, edge, 1);
  assert.equal(removed.edges[0].route.length, route.length - 1);
  assert.equal(removeWaypoint(shifted, edge, 0), shifted);
});

test('undo and redo restore exact previous arrangements and discard a branched redo', () => {
  const initial = blankDiagram();
  const { diagram } = editedDiagram();
  const history = new History(initial);
  assert.equal(history.commit(diagram), true);
  assert.equal(history.commit(diagram), false);
  history.undo();
  assert.equal(history.current, initial);
  history.redo();
  assert.equal(history.current, diagram);
  history.undo();
  history.commit(addNode(initial, 'lane-1', 'Alternate').diagram);
  history.redo();
  assert.equal(history.current.nodes[0].label, 'Alternate');
});

test('save, open, and JSON round trip retain manual routes, dimensions and metadata exactly', () => {
  const { diagram } = editedDiagram();
  diagram.metadata = { project: 'PA', schema: { state: 12 } };
  diagram.edges[0].metadata = { guard: 'accepted' };
  const storage = new MemoryStorage();
  const firstSession = new DiagramStorage(storage);
  const id = firstSession.save(null, diagram);
  const otherId = firstSession.save(null, blankDiagram('Another activity'));
  const secondSession = new DiagramStorage(storage);
  assert.equal(secondSession.list().length, 2);
  assert.deepEqual(secondSession.open(id), diagram);
  assert.equal(secondSession.last().id, otherId);
  assert.equal(secondSession.save(id, diagram), id);
  assert.deepEqual(secondSession.last().diagram, diagram);
  assert.deepEqual(importDiagram(exportDiagram(diagram), () => assert.fail('Complete layout must never regenerate')), diagram);
});

test('layout-less graph imports invoke layout once and preserve semantics', () => {
  const text = readFileSync(new URL('../examples/fulfillment.json', import.meta.url), 'utf8');
  let calls = 0;
  const diagram = importDiagram(text, (input) => {
    calls++;
    return optimizeLayout(input);
  });
  assert.equal(calls, 1);
  assert.deepEqual(diagram.metadata, JSON.parse(text).metadata);
  assert.ok(diagram.edges.every((edge) => edge.route.length >= 2));
});

test('malformed and partial diagrams surface validation errors', () => {
  assert.throws(() => parseDiagram('[oops'), /valid JSON/);
  assert.throws(() => validateDiagram({ lanes: [], nodes: [], edges: [] }), /swimlane is required/);
  const { diagram } = editedDiagram();
  assert.throws(() => validateDiagram({ ...diagram, version: 9 }), /version/);
  assert.throws(() => validateDiagram({ ...diagram, edges: [{ ...diagram.edges[0], target: 'missing' }] }), /unknown node/);
  assert.throws(() => validateDiagram({ ...diagram, nodes: [diagram.nodes[0], diagram.nodes[0]] }), /Duplicate node/);
  assert.throws(() => validateDiagram({ ...diagram, nodes: [{ ...diagram.nodes[0], x: 1 }, diagram.nodes[1]] }), /outside its swimlane/);
  assert.throws(() => validateDiagram({ ...diagram, edges: [{ ...diagram.edges[0], route: [] }] }), /needs a route/);
  const { layout, ...partial } = diagram;
  assert.throws(() => validateDiagram(partial), /Partial layout/);
});
