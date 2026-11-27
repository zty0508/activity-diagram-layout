import { compactRoute, crossingCount, overlaps, routeLength, segmentHitsBox, segments } from './geometry.js';

export const METRICS = [
  ['crossings', 'Edge crossings'],
  ['overlaps', 'Overlapping nodes'],
  ['obstructions', 'Edges through nodes'],
  ['length', 'Total edge length'],
  ['bends', 'Edge bends'],
];

export function measure(diagram) {
  const result = { crossings: 0, overlaps: 0, obstructions: 0, length: 0, bends: 0 };
  for (let i = 0; i < diagram.nodes.length; i++) {
    for (let j = 0; j < i; j++) {
      if (overlaps(diagram.nodes[i], diagram.nodes[j])) result.overlaps++;
    }
  }
  const routes = diagram.edges.map((edge) => compactRoute(edge.route));
  for (let i = 0; i < diagram.edges.length; i++) {
    const edge = diagram.edges[i];
    const route = routes[i];
    const lines = segments(route);
    result.length += routeLength(route);
    result.bends += Math.max(0, route.length - 2);
    if (diagram.nodes.some((node) => node.id !== edge.source && node.id !== edge.target &&
      lines.some(([a, b]) => segmentHitsBox(a, b, node)))) result.obstructions++;
    for (let j = 0; j < i; j++) result.crossings += crossingCount(route, routes[j]);
  }
  return result;
}
