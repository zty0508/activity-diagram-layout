import { readdirSync, readFileSync } from 'node:fs';
import { optimizeLayout } from '../src/layout.js';
import { parseDiagram } from '../src/model.js';

const directory = new URL('../examples/', import.meta.url);
const rows = [];
for (const file of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
  const input = parseDiagram(readFileSync(new URL(file, directory), 'utf8'));
  const { diagram, naive, smart } = optimizeLayout(input);
  const row = { Example: file };
  for (const key of Object.keys(naive)) row[key] = `${Math.round(naive[key])} → ${Math.round(smart[key])}`;
  row.lanes = diagram.lanes.map(({ id }) => id).join(', ');
  rows.push(row);
}
console.table(rows);
