const EPSILON = 1e-7;

export const center = (node) => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 });
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const samePoint = (a, b) => a.x === b.x && a.y === b.y;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const segments = (route) => route.slice(1).map((point, index) => [route[index], point]);
const cross = (a, b) => a.x * b.y - a.y * b.x;
const vector = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });

export function boundaryPoint(node, toward, fallback = 'bottom') {
  const middle = center(node);
  const dx = toward.x - middle.x;
  const dy = toward.y - middle.y;
  const scale = Math.max(Math.abs(dx) / (node.width / 2), Math.abs(dy) / (node.height / 2));
  if (scale === 0) return { x: middle.x, y: fallback === 'bottom' ? node.y + node.height : node.y };
  return { x: middle.x + dx / scale, y: middle.y + dy / scale };
}

export function compactRoute(points) {
  const route = [];
  for (const point of points) {
    const last = route.at(-1);
    if (last && samePoint(last, point)) continue;
    const previous = route.at(-2);
    if (previous) {
      const incoming = vector(previous, last);
      const outgoing = vector(last, point);
      if (Math.abs(cross(incoming, outgoing)) < EPSILON &&
        incoming.x * outgoing.x + incoming.y * outgoing.y > 0) route.pop();
    }
    route.push(point);
  }
  return route;
}

export function segmentHitsBox(a, b, box) {
  // Clip to the open rectangle so a segment along its boundary is clear.
  let low = 0;
  let high = 1;
  for (const [axis, size] of [['x', 'width'], ['y', 'height']]) {
    const delta = b[axis] - a[axis];
    const min = box[axis] + EPSILON;
    const max = box[axis] + box[size] - EPSILON;
    if (min > max) return false;
    if (delta === 0) {
      if (a[axis] < min || a[axis] > max) return false;
      continue;
    }
    const t1 = (min - a[axis]) / delta;
    const t2 = (max - a[axis]) / delta;
    low = Math.max(low, Math.min(t1, t2));
    high = Math.min(high, Math.max(t1, t2));
    if (low > high) return false;
  }
  return true;
}

export function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

function intersection(a, b, c, d) {
  const ab = vector(a, b);
  const cd = vector(c, d);
  const divisor = cross(ab, cd);
  if (Math.abs(divisor) < EPSILON) return null;
  const ac = vector(a, c);
  const t = cross(ac, cd) / divisor;
  const u = cross(ac, ab) / divisor;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return { x: a.x + ab.x * t, y: a.y + ab.y * t, t, u };
}

function crossingRays(route, index, parameter, point) {
  if (parameter <= EPSILON && index === 0) return null;
  if (parameter >= 1 - EPSILON && index === route.length - 2) return null;
  const before = route[parameter <= EPSILON ? index - 1 : index];
  const after = route[parameter >= 1 - EPSILON ? index + 2 : index + 1];
  return [before, after].map((end) => {
    const angle = Math.atan2(end.y - point.y, end.x - point.x);
    return (angle + 2 * Math.PI) % (2 * Math.PI);
  });
}

export function crossingCount(first, second) {
  const crossings = new Set();
  for (let i = 0; i < first.length - 1; i++) {
    for (let j = 0; j < second.length - 1; j++) {
      const point = intersection(first[i], first[i + 1], second[j], second[j + 1]);
      if (!point) continue;
      const raysA = crossingRays(first, i, point.t, point);
      const raysB = crossingRays(second, j, point.u, point);
      if (!raysA || !raysB) continue;
      const rays = [...raysA.map((angle) => ({ angle, edge: 0 })), ...raysB.map((angle) => ({ angle, edge: 1 }))]
        .sort((a, b) => a.angle - b.angle);
      if (rays.every((ray, index) => {
        const next = rays[(index + 1) % 4];
        return ray.edge !== next.edge && (next.angle - ray.angle + 2 * Math.PI) % (2 * Math.PI) > EPSILON;
      })) crossings.add(`${point.x.toFixed(6)},${point.y.toFixed(6)}`);
    }
  }
  return crossings.size;
}

export function sharedLength(first, second) {
  let length = 0;
  for (const [a, b] of segments(first)) {
    for (const [c, d] of segments(second)) {
      if (a.x === b.x && c.x === d.x && a.x === c.x) {
        length += intervalOverlap(a.y, b.y, c.y, d.y);
      } else if (a.y === b.y && c.y === d.y && a.y === c.y) {
        length += intervalOverlap(a.x, b.x, c.x, d.x);
      }
    }
  }
  return length;
}

function intervalOverlap(a, b, c, d) {
  return Math.max(0, Math.min(Math.max(a, b), Math.max(c, d)) - Math.max(Math.min(a, b), Math.min(c, d)));
}

export function routeLength(route) {
  return segments(route).reduce((sum, [a, b]) => sum + distance(a, b), 0);
}

export function contentBounds(diagram) {
  const xs = [0, diagram.layout.width];
  const ys = [0, diagram.layout.height];
  for (const edge of diagram.edges) {
    for (const point of edge.route) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  const left = xs.reduce((a, b) => Math.min(a, b));
  const right = xs.reduce((a, b) => Math.max(a, b));
  const top = ys.reduce((a, b) => Math.min(a, b));
  const bottom = ys.reduce((a, b) => Math.max(a, b));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
