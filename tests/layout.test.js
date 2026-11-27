import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { crossingCount, segmentHitsBox } from '../src/geometry.js';
import { layerGraph } from '../src/layers.js';
import { optimizeLayout } from '../src/layout.js';
import { measure } from '../src/metrics.js';
import { LANE_HEADER, parseDiagram, validateDiagram } from '../src/model.js';

const example = (name) => parseDiagram(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
function onBoundary(node, point) {
  const right = node.x + node.width;
  const bottom = node.y + node.height;
  const inside = point.x >= node.x && point.x <= right && point.y >= node.y && point.y <= bottom;
  return inside && (point.x === node.x || point.x === right || point.y === node.y || point.y === bottom);
}

for (const name of ['sequence', 'branch', 'parallel', 'loop', 'fulfillment', 'incident']) {
  test(`${name}: validity, topology, membership, routing and determinism`, () => {
    const input = example(name);
    const untouched = structuredClone(input);
    const result = optimizeLayout(input);
    const { diagram, naive, smart } = result;
    assert.deepEqual(optimizeLayout(input), result);
    assert.deepEqual(input, untouched);
    assert.deepEqual(validateDiagram(diagram), diagram);
    assert.deepEqual(diagram.nodes.map(({ x, y, width, height, ...semantic }) => semantic), input.nodes);
    assert.deepEqual(diagram.edges.map(({ route, ...semantic }) => semantic), input.edges);
    assert.deepEqual(diagram.metadata, input.metadata);
    assert.equal(smart.overlaps, 0);
    assert.equal(smart.obstructions, 0);
    assert.ok(smart.crossings <= naive.crossings);
    const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
    const { feedback } = layerGraph(input);
    for (const edge of diagram.edges) {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      assert.ok(onBoundary(source, edge.route[0]), `${edge.id} source port`);
      assert.ok(onBoundary(target, edge.route.at(-1)), `${edge.id} target port`);
      if (!feedback.has(edge.id)) assert.ok(source.y + source.height < target.y);
      for (let i = 1; i < edge.route.length; i++) {
        const a = edge.route[i - 1];
        const b = edge.route[i];
        assert.ok(a.x === b.x || a.y === b.y, `${edge.id} has orthogonal routes`);
      }
    }
    for (const node of diagram.nodes) {
      const lane = diagram.lanes.find((entry) => entry.id === node.laneId);
      assert.ok(node.x >= lane.x && node.x + node.width <= lane.x + lane.width);
      assert.ok(node.y >= lane.y + LANE_HEADER && node.y + node.height <= lane.y + lane.height);
    }
  });
}

test('connected lane order improves on the unfavorable fulfillment input', () => {
  const input = example('fulfillment');
  const { diagram, naive, smart } = optimizeLayout(input);
  assert.deepEqual(input.lanes.map(({ id }) => id), ['customer', 'warehouse', 'operations']);
  assert.deepEqual(diagram.lanes.map(({ id }) => id), ['customer', 'operations', 'warehouse']);
  assert.ok(smart.length < naive.length * 0.85);
});

test('parallel and incident examples have fewer crossings after optimization', () => {
  for (const name of ['parallel', 'incident']) {
    const { naive, smart } = optimizeLayout(example(name));
    assert.ok(naive.crossings > 0);
    assert.equal(smart.crossings, 0);
  }
});

test('feedback edges preserve original source and target including the self-loop', () => {
  const input = example('loop');
  assert.deepEqual([...layerGraph(input).feedback], ['e3', 'e5']);
  const { diagram } = optimizeLayout(input);
  const self = diagram.edges.find((edge) => edge.source === edge.target);
  assert.ok(self.route.length >= 5);
  assert.ok(diagram.edges.find(({ id }) => id === 'e3').route.length >= 5);
});

test('large custom dimensions, multiple components and empty lanes are supported', () => {
  const input = example('sequence');
  input.lanes.push({ id: 'empty', width: 300 });
  input.nodes[1].height = 175;
  input.nodes[1].width = 330;
  input.nodes.push({ id: 'standalone', laneId: 'operations', width: 600, height: 92, metadata: { task: 24 } });
  const { diagram, smart } = optimizeLayout(input);
  const detached = diagram.nodes.at(-1);
  assert.ok(detached.y > diagram.nodes.at(-2).y + diagram.nodes.at(-2).height);
  assert.equal(diagram.lanes[1].width, 300);
  assert.equal(detached.width, 600);
  assert.equal(smart.obstructions, 0);
  assert.equal(smart.overlaps, 0);
  assert.deepEqual(validateDiagram(diagram), diagram);
});

test('crossings distinguish transverse intersections from shared runs and touches', () => {
  const route = (...pairs) => pairs.map(([x, y]) => ({ x, y }));
  const horizontal = route([0, 5], [10, 5]);
  assert.equal(crossingCount(horizontal, route([5, 0], [5, 10])), 1);
  assert.equal(crossingCount(horizontal, route([5, 0], [5, 5], [5, 10])), 1);
  assert.equal(crossingCount(horizontal, route([5, 5], [5, 10])), 0);
  assert.equal(crossingCount(horizontal, route([4, 5], [8, 5])), 0);
  assert.equal(crossingCount(horizontal, route([3, 1], [5, 5], [7, 1])), 0);
});

test('metrics count overlaps, distinct obstructed edges, length, and true bends', () => {
  const route = [{ x: 0, y: 6 }, { x: 3, y: 6 }, { x: 10, y: 6 }, { x: 10, y: 15 }];
  const nodes = [{ id: 'box-1', x: 4, y: 5, width: 2, height: 2 }, { id: 'box-2', x: 5, y: 5, width: 3, height: 2 }];
  assert.equal(segmentHitsBox({ x: 0, y: 5 }, { x: 10, y: 5 }, nodes[0]), false);
  assert.deepEqual(measure({ nodes, edges: [{ source: 'source', target: 'target', route }] }),
    { crossings: 0, overlaps: 1, obstructions: 1, length: 19, bends: 1 });
});
