function connectedComponents(diagram) {
  const neighbors = new Map(diagram.nodes.map(({ id }) => [id, []]));
  for (const edge of diagram.edges) {
    neighbors.get(edge.source).push(edge.target);
    neighbors.get(edge.target).push(edge.source);
  }
  const components = new Map();
  for (const { id } of diagram.nodes) {
    if (components.has(id)) continue;
    const queue = [id];
    const component = components.size;
    components.set(id, component);
    for (const current of queue) {
      for (const neighbor of neighbors.get(current)) {
        if (components.has(neighbor)) continue;
        components.set(neighbor, component);
        queue.push(neighbor);
      }
    }
  }
  return components;
}

export function layerGraph(diagram) {
  const outgoing = new Map(diagram.nodes.map(({ id }) => [id, []]));
  const incoming = new Map(diagram.nodes.map(({ id }) => [id, 0]));
  for (const edge of diagram.edges) {
    outgoing.get(edge.source).push(edge);
    if (edge.target !== edge.source) incoming.set(edge.target, incoming.get(edge.target) + 1);
  }

  // Start with actual entries when possible. Gray targets identify DFS feedback edges.
  const starts = [...diagram.nodes].sort((a, b) => Number(incoming.get(a.id) > 0) - Number(incoming.get(b.id) > 0));
  const active = new Set();
  const visited = new Set();
  const feedback = new Set();
  const order = [];
  for (const { id } of starts) {
    if (visited.has(id)) continue;
    visited.add(id);
    active.add(id);
    const stack = [{ id, cursor: 0 }];
    while (stack.length) {
      const frame = stack.at(-1);
      const edge = outgoing.get(frame.id)[frame.cursor++];
      if (!edge) {
        active.delete(frame.id);
        order.push(stack.pop().id);
      } else if (active.has(edge.target)) {
        feedback.add(edge.id);
      } else if (!visited.has(edge.target)) {
        active.add(edge.target);
        visited.add(edge.target);
        stack.push({ id: edge.target, cursor: 0 });
      }
    }
  }

  const ranks = new Map(diagram.nodes.map(({ id }) => [id, 0]));
  for (const id of order.reverse()) {
    for (const edge of outgoing.get(id)) {
      if (feedback.has(edge.id)) continue;
      ranks.set(edge.target, Math.max(ranks.get(edge.target), ranks.get(id) + 1));
    }
  }
  const components = connectedComponents(diagram);
  const sizes = new Map();
  for (const [id, rank] of ranks) {
    const component = components.get(id);
    sizes.set(component, Math.max(sizes.get(component) ?? 0, rank + 1));
  }
  let height = 0;
  const offsets = new Map();
  for (const [component, size] of sizes) {
    offsets.set(component, height);
    height += size + 1;
  }
  const rows = Array.from({ length: Math.max(0, height - 1) }, () => []);
  const vertices = new Map();
  for (const node of diagram.nodes) {
    const rank = ranks.get(node.id) + offsets.get(components.get(node.id));
    const vertex = { node, rank, laneId: node.laneId, links: [] };
    vertices.set(node.id, vertex);
    rows[rank].push(vertex);
  }
  const links = [];
  for (const edge of diagram.edges) {
    if (feedback.has(edge.id)) continue;
    let previous = vertices.get(edge.source);
    const target = vertices.get(edge.target);
    const span = target.rank - previous.rank;
    for (let step = 1; step < span; step++) {
      const ghost = { rank: previous.rank + 1, laneId: step * 2 < span ? vertices.get(edge.source).laneId : target.laneId, links: [] };
      rows[ghost.rank].push(ghost);
      link(previous, ghost);
      previous = ghost;
    }
    link(previous, target);
  }

  function link(a, b) {
    a.links.push(b);
    b.links.push(a);
    links.push([a, b]);
  }

  return { rows, feedback, links };
}

function rowPositions(rows, laneIndex) {
  const positions = new Map();
  for (const row of rows) {
    const totals = new Map();
    const seen = new Map();
    for (const vertex of row) totals.set(vertex.laneId, (totals.get(vertex.laneId) ?? 0) + 1);
    for (const vertex of row) {
      const count = (seen.get(vertex.laneId) ?? 0) + 1;
      seen.set(vertex.laneId, count);
      positions.set(vertex, laneIndex.get(vertex.laneId) + count / (totals.get(vertex.laneId) + 1));
    }
  }
  return positions;
}

function orderingCost(rows, laneIndex, links) {
  const positions = rowPositions(rows, laneIndex);
  const boundaries = new Map();
  for (const [a, b] of links) {
    if (!boundaries.has(a.rank)) boundaries.set(a.rank, []);
    boundaries.get(a.rank).push([positions.get(a), positions.get(b)]);
  }
  let cost = 0;
  for (const boundary of boundaries.values()) {
    for (let i = 0; i < boundary.length; i++) {
      const [a, b] = boundary[i];
      cost += Math.abs(a - b);
      for (let j = 0; j < i; j++) {
        const [c, d] = boundary[j];
        if ((a - c) * (b - d) < 0) cost += 8;
      }
    }
  }
  return cost;
}

export function orderRows(layered, lanes) {
  const laneIndex = new Map(lanes.map((lane, index) => [lane.id, index]));
  const rows = layered.rows.map((row) => [...row]);
  let best = rows.map((row) => [...row]);
  let cost = orderingCost(rows, laneIndex, layered.links);
  for (let pass = 0; pass < 8; pass++) {
    const direction = pass % 2 === 0 ? 1 : -1;
    const positions = rowPositions(rows, laneIndex);
    for (let cursor = 0; cursor < rows.length; cursor++) {
      const index = direction === 1 ? cursor : rows.length - 1 - cursor;
      const row = rows[index];
      const weights = new Map(row.map((vertex) => {
        const adjacent = vertex.links.filter((neighbor) => neighbor.rank === index - direction);
        const score = adjacent.length
          ? adjacent.reduce((sum, neighbor) => sum + positions.get(neighbor), 0) / adjacent.length
          : positions.get(vertex);
        return [vertex, score];
      }));
      row.sort((a, b) => laneIndex.get(a.laneId) - laneIndex.get(b.laneId) || weights.get(a) - weights.get(b));
      for (const [vertex, x] of rowPositions([row], laneIndex)) positions.set(vertex, x);
    }
    const candidate = orderingCost(rows, laneIndex, layered.links);
    if (candidate < cost) {
      best = rows.map((row) => [...row]);
      cost = candidate;
    }
  }
  return { rows: best, cost };
}

export function laneOrders(diagram) {
  const lanes = diagram.lanes;
  if (lanes.length <= 1) return [lanes];
  const laneOf = new Map(diagram.nodes.map((node) => [node.id, node.laneId]));
  const weights = new Map(lanes.map((lane) => [lane.id, new Map()]));
  for (const edge of diagram.edges) {
    const a = laneOf.get(edge.source);
    const b = laneOf.get(edge.target);
    if (a === b) continue;
    for (const [left, right] of [[a, b], [b, a]]) {
      const weightsFromLeft = weights.get(left);
      weightsFromLeft.set(right, (weightsFromLeft.get(right) ?? 0) + 1);
    }
  }
  if ([...weights.values()].every((neighbors) => !neighbors.size)) return [lanes];
  const span = (order) => {
    const index = new Map(order.map((lane, i) => [lane.id, i]));
    return order.reduce((total, lane, i) => total + [...weights.get(lane.id)].reduce(
      (sum, [id, count]) => sum + count * Math.abs(i - index.get(id)), 0), 0) / 2;
  };
  const candidates = new Map();
  const add = (order) => candidates.set(JSON.stringify(order.map((lane) => lane.id)), order);
  if (lanes.length <= 5) {
    function permute(prefix, remaining) {
      if (!remaining.length) add(prefix);
      for (const lane of remaining) permute([...prefix, lane], remaining.filter((other) => other !== lane));
    }
    permute([], lanes);
  } else {
    for (const seed of [lanes, [...lanes].reverse(), [...lanes].sort((a, b) =>
      weights.get(b.id).size - weights.get(a.id).size)]) {
      let best = seed;
      for (let pass = 0; pass < 6; pass++) {
        let next = best;
        let bestSpan = span(best);
        for (let i = 0; i < best.length; i++) {
          for (let j = i + 1; j < best.length; j++) {
            const trial = [...best];
            [trial[i], trial[j]] = [trial[j], trial[i]];
            const cost = span(trial);
            if (cost < bestSpan) {
              bestSpan = cost;
              next = trial;
            }
          }
        }
        if (next === best) break;
        best = next;
      }
      add(best);
    }
  }
  const sorted = [...candidates.values()].sort((a, b) => span(a) - span(b));
  return [lanes, ...sorted.filter((order) => order.some((lane, index) => lane !== lanes[index])).slice(0, 7)];
}
