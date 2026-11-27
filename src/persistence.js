import { validateDiagram, parseDiagram } from './model.js';

const STORAGE_KEY = 'activity-diagram-layout:v1';

export function importDiagram(text, layoutGraph) {
  const diagram = parseDiagram(text);
  return diagram.layout ? diagram : layoutGraph(diagram).diagram;
}

export function exportDiagram(diagram) {
  return JSON.stringify(validateDiagram(diagram), null, 2) + '\n';
}

export class DiagramStorage {
  constructor(storage) {
    this.storage = storage;
  }

  read() {
    const text = this.storage.getItem(STORAGE_KEY);
    if (!text) return { last: null, entries: [] };
    const data = JSON.parse(text);
    if (!Array.isArray(data?.entries)) throw new Error('Saved diagram index is invalid.');
    return data;
  }

  list() {
    return this.read().entries.map(({ id, title, savedAt }) => ({ id, title, savedAt }));
  }

  open(id) {
    const entry = this.read().entries.find((item) => item.id === id);
    if (!entry) throw new Error('This saved diagram could not be found.');
    return validateDiagram(entry.diagram);
  }

  last() {
    const data = this.read();
    if (!data.last) return null;
    return { id: data.last, diagram: this.open(data.last) };
  }

  save(id, diagram) {
    const validated = validateDiagram(diagram);
    if (!validated.layout) throw new Error('A saved diagram must have a complete layout.');
    const data = this.read();
    const key = id ?? globalThis.crypto.randomUUID();
    const entry = { id: key, title: validated.title, savedAt: new Date().toISOString(), diagram: validated };
    data.entries = [entry, ...data.entries.filter((item) => item.id !== key)];
    data.last = key;
    this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return key;
  }
}
