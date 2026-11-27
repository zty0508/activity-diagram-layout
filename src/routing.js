import { center, compactRoute, crossingCount, routeLength, segmentHitsBox, segments, sharedLength } from './geometry.js';

function ports(diagram, byId) {
  const result = new Map(diagram.edges.map(({ id }) => [id, {}]));
  const groups = new Map();
  for (const edge of diagram.edges) {
    for (const [role, opposite] of [['source', 'target'], ['target', 'source']]) {
      const key = JSON.stringify([edge[role], role]);
      if (!groups.has(key)) groups.set(key, { node: byId.get(edge[role]), role, entries: [] });
      groups.get(key).entries.push({ edge, peer: center(byId.get(edge[opposite])) });
    }
  }
  for (const { node, role, entries } of groups.values()) {
    entries.sort((a, b) => a.peer.x - b.peer.x || a.peer.y - b.peer.y);
    entries.forEach(({ edge }, index) => {
      const offset = (index + 1) / (entries.length + 1) - 0.5;
      result.get(edge.id)[role] = {
        x: node.x + node.width * (0.5 + offset * 0.72),
        y: role === 'source' ? node.y + node.height : node.y,
      };
    });
  }
  return result;
}

export function naiveRoutes(diagram, feedback) {
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  return diagram.edges.map((edge, index) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const start = { x: center(source).x, y: source.y + source.height };
    const end = { x: center(target).x, y: target.y };
    if (feedback.has(edge.id)) {
      const x = Math.min(source.x, target.x) - 16;
      return compactRoute([start, { x: start.x, y: start.y + 14 }, { x, y: start.y + 14 },
        { x, y: end.y - 14 }, { x: end.x, y: end.y - 14 }, end]);
    }
    const y = (start.y + end.y) / 2 + ((index % 7) - 3) * 3;
    return compactRoute([start, { x: start.x, y }, { x: end.x, y }, end]);
  });
}

function compare(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function clearCost(route, nodes) {
  const lines = segments(route);
  let blocked = 0;
  for (const node of nodes) {
    if (lines.some(([a, b]) =>
      Math.max(a.x, b.x) > node.x && Math.min(a.x, b.x) < node.x + node.width &&
      Math.max(a.y, b.y) > node.y && Math.min(a.y, b.y) < node.y + node.height &&
      segmentHitsBox(a, b, node))) blocked++;
  }
  return blocked;
}

function candidateRoutes(diagram, start, end, sourceRow, targetRow, backward) {
  const reach = (point, x, y) => [point, { x: point.x, y }, { x, y }];
  const routes = [];
  const add = (points) => routes.push(compactRoute(points));
  if (!backward) {
    const low = sourceRow.bottom + 10;
    const high = targetRow.top - 10;
    for (const fraction of [0.5, 0.28, 0.72, 0, 1]) {
      const y = low + (high - low) * fraction;
      add([start, { x: start.x, y }, { x: end.x, y }, end]);
    }
  }

  const firstLane = diagram.lanes[0];
  const lastLane = diagram.lanes.at(-1);
  const left = firstLane.x;
  const right = lastLane.x + lastLane.width;
  const channels = [left - 16, right + 16, left - 30, right + 30];
  for (const lane of diagram.lanes) {
    channels.push(lane.x + 9, lane.x + lane.width - 9);
  }
  if (!backward) {
    channels.push(start.x, end.x, (start.x + end.x) / 2);
    for (const node of diagram.nodes) {
      if (node.y > end.y || node.y + node.height < start.y) continue;
      channels.push(node.x - 9, node.x + node.width + 9);
    }
  }
  const towardMiddle = (x) => Math.abs(start.x - x) + Math.abs(end.x - x);
  const sorted = [...new Set(channels)].sort((a, b) => towardMiddle(a) - towardMiddle(b));
  // Always retain the perimeter channels even when a dense diagram has many candidate tracks.
  const tracks = [...new Set([...channels.slice(0, 4), ...sorted.slice(0, 20)])];
  for (const x of tracks) {
    for (const [down, up] of [[17, 17], [30, 30], [10, 25]]) {
      add([...reach(start, x, sourceRow.bottom + down), ...reach(end, x, targetRow.top - up).reverse()]);
    }
  }
  return routes;
}

export function smartRoutes(diagram, ranks, rowBounds, feedback) {
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  const anchors = ports(diagram, byId);
  const candidates = diagram.edges.map((edge) => {
    const { source, target } = anchors.get(edge.id);
    const backward = feedback.has(edge.id);
    const routes = candidateRoutes(diagram, source, target, rowBounds.get(ranks.get(edge.source)),
      rowBounds.get(ranks.get(edge.target)), backward);
    const unique = new Map();
    for (const route of routes) {
      const key = JSON.stringify(route);
      if (unique.has(key)) continue;
      const track = route[2]?.x;
      const lastLane = diagram.lanes.at(-1);
      const outside = track < diagram.lanes[0].x || track > lastLane.x + lastLane.width;
      const aesthetic = routeLength(route) + (route.length - 2) * 14 + (backward && !outside ? 90 : 0);
      unique.set(key, { route, blocked: clearCost(route, diagram.nodes), aesthetic });
    }
    const sorted = [...unique.values()].sort((a, b) => a.blocked - b.blocked || a.aesthetic - b.aesthetic);
    return sorted.filter((candidate) => candidate.blocked === sorted[0].blocked);
  });
  const chosen = candidates.map(() => null);
  const indices = diagram.edges.map((_, index) => index).sort((a, b) =>
    Number(feedback.has(diagram.edges[a].id)) - Number(feedback.has(diagram.edges[b].id)) ||
    candidates[a].length - candidates[b].length);
  const passes = diagram.edges.length > 100 ? 1 : 3;
  for (let pass = 0; pass < passes; pass++) {
    for (const index of pass % 2 ? [...indices].reverse() : indices) {
      let best = chosen[index];
      let bestScore = best ? score(best) : [Infinity];
      for (const candidate of candidates[index]) {
        const value = score(candidate);
        if (compare(value, bestScore) < 0) {
          bestScore = value;
          best = candidate;
        }
      }
      chosen[index] = best;

      function score(candidate) {
        let crossings = 0;
        let shared = 0;
        for (let i = 0; i < chosen.length; i++) {
          if (i === index || !chosen[i]) continue;
          crossings += crossingCount(candidate.route, chosen[i].route);
          shared += sharedLength(candidate.route, chosen[i].route);
        }
        return [crossings, candidate.aesthetic + shared * 2];
      }
    }
  }
  return chosen.map(({ route }) => route);
}
