import { addEdge, addLane, addNode, addWaypoint, blankDiagram, History, moveNode, moveSegment, moveWaypoint,
  removeSelection, removeWaypoint, reorderLane, resizeHeight, resizeLane, setLabel } from './editor.js';
import { clamp, contentBounds } from './geometry.js';
import { addIcons } from './icons.js';
import { optimizeLayout } from './layout.js';
import { measure, METRICS } from './metrics.js';
import { DiagramStorage, exportDiagram, importDiagram } from './persistence.js';
import { draw, labelOf } from './render.js';

const EXAMPLES = [
  ['sequence', 'Travel request', 'Sequential activities'],
  ['branch', 'Access decision', 'Alternative paths and a merge'],
  ['parallel', 'Content release', 'Parallel work, fork and join'],
  ['loop', 'Document review', 'Backward edge and self-loop'],
  ['fulfillment', 'Order fulfillment', 'Cross-lane connections'],
  ['incident', 'Incident response', 'Swimlanes, parallel work and retry'],
];

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const drawing = $('drawing');
const dialog = $('dialog');
const history = new History(blankDiagram());
let repository;
let selected = null;
let connecting = null;
let gesture = null;
let savedId = null;
let cleanDiagram = history.current;
let exampleActive = false;
let view = { x: 0, y: 0, scale: 1 };
let viewAdjusted = false;
let submitDialog;
let operation = 0;

function status(message = '', error = false) {
  $('status').textContent = message;
  $('status').dataset.error = error;
}

function isDirty() {
  return current() !== cleanDiagram;
}

function setIndicator() {
  $('save-indicator').dataset.dirty = isDirty();
  $('save-text').textContent = isDirty() ? 'Unsaved changes' : savedId ? 'Saved locally' : exampleActive ? 'Example diagram' : 'Not saved';
}

function current() {
  return history.current;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function button(label, action, disabled = false) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.disabled = disabled;
  element.addEventListener('click', action);
  return element;
}

function field(label, control) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  wrapper.append(label, control);
  return wrapper;
}

function inputField(label, value, type = 'text') {
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  if (type === 'number') input.step = 'any';
  return [field(label, input), input];
}

function selectedItem(diagram) {
  const key = { lane: 'lanes', node: 'nodes', edge: 'edges' }[selected?.kind];
  return key ? diagram[key].find((item) => item.id === selected.id) : undefined;
}

function renderMetrics(diagram) {
  const metrics = measure(diagram);
  const baseline = diagram.layout.baseline;
  const hasBaseline = METRICS.every(([key]) => Number.isFinite(baseline?.[key]));
  const manual = diagram.layout.manual;
  $('current-metric').textContent = manual || !hasBaseline ? 'Current' : 'Smart';
  $('metrics-note').hidden = hasBaseline;
  $('metrics-note').textContent = hasBaseline ? '' : 'Run Auto Layout to generate a comparison.';
  const rows = METRICS.map(([key, label]) => {
    const row = document.createElement('tr');
    const title = document.createElement('th');
    title.scope = 'row';
    title.textContent = label;
    const naive = document.createElement('td');
    naive.textContent = hasBaseline ? Math.round(baseline[key]).toLocaleString() : '—';
    const value = document.createElement('td');
    const metric = document.createElement('span');
    metric.className = 'metric-value';
    metric.textContent = Math.round(metrics[key]).toLocaleString();
    if (hasBaseline && Math.round(metrics[key]) !== Math.round(baseline[key])) {
      metric.classList.add(metrics[key] < baseline[key] ? 'metric-better' : 'metric-worse');
    }
    value.append(metric);
    row.append(title, naive, value);
    return row;
  });
  $('metric-rows').replaceChildren(...rows);
}

function renderInspector(diagram) {
  const container = $('inspector-content');
  const item = selectedItem(diagram);
  if (!item) {
    const empty = document.createElement('p');
    empty.className = 'inspect-empty';
    empty.textContent = 'Select a node, an edge, or a swimlane header to edit its properties.';
    container.replaceChildren(empty);
    return;
  }

  const info = document.createElement('p');
  info.className = 'inspect-kind';
  const lane = diagram.lanes.find(({ id }) => id === item.laneId);
  const byId = new Map(diagram.nodes.map((node) => [node.id, node]));
  info.textContent = selected.kind === 'node' ? [lane && labelOf(lane), typeof item.type === 'string' && item.type].filter(Boolean).join(' · ')
    : selected.kind === 'edge' ? `${labelOf(byId.get(item.source))} → ${labelOf(byId.get(item.target))}` : 'Swimlane';
  const [label, input] = inputField('Label', item.label ?? '');
  const selection = selected;
  input.addEventListener('change', () => {
    input.value = input.value.trim();
    commit(setLabel(current(), selection, input.value), { inspector: false });
  });
  container.replaceChildren(info, label);

  if (selected.kind === 'lane') {
    const [widthLabel, width] = inputField('Width', item.width, 'number');
    const [heightLabel, height] = inputField('Shared height', item.height, 'number');
    width.addEventListener('change', () => updateSize(width, item.width, (value) => resizeLane(current(), item.id, value)));
    height.addEventListener('change', () => updateSize(height, item.height, (value) => resizeHeight(current(), value)));
    const fields = document.createElement('div');
    fields.className = 'field-pair';
    fields.append(widthLabel, heightLabel);
    const actions = document.createElement('div');
    actions.className = 'inspect-row';
    const index = diagram.lanes.indexOf(item);
    actions.append(button('Move Left', () => commit(reorderLane(current(), item.id, index - 1)), index === 0),
      button('Move Right', () => commit(reorderLane(current(), item.id, index + 1)), index === diagram.lanes.length - 1));
    container.append(fields, actions);
  }

  if (selected.kind === 'edge') {
    const actions = document.createElement('div');
    actions.className = 'inspect-row';
    actions.append(button('Add Waypoint', () => {
      const changed = addWaypoint(current(), item.id);
      const route = changed.edges.find(({ id }) => id === item.id).route;
      selected = { ...selection, waypoint: route.findIndex((point) => !item.route.includes(point)) };
      commit(changed);
    }), button('Remove Waypoint', () => deleteSelection(), selected.waypoint === undefined));
    const help = document.createElement('p');
    help.className = 'metrics-note';
    help.textContent = 'Drag circles to move waypoints or squares to move segments.';
    container.append(actions, help);
  }
}

function updateSize(input, original, resize) {
  if (!Number.isFinite(input.valueAsNumber) || !commit(resize(input.valueAsNumber))) input.value = original;
}

function paint(diagram = current()) {
  draw(drawing, diagram, selected, connecting);
  $('canvas-mode').hidden = !connecting;
  viewport.classList.toggle('is-connecting', Boolean(connecting));
  $('canvas-mode').textContent = connecting?.source ? 'Choose the target node · Esc to cancel' : 'Choose the source node · Esc to cancel';
}

function render({ inspector = true } = {}) {
  const diagram = current();
  if (selected && !selectedItem(diagram)) selected = null;
  $('diagram-heading').textContent = diagram.title || 'Untitled diagram';
  $('diagram-counts').textContent = [plural(diagram.lanes.length, 'swimlane'), plural(diagram.nodes.length, 'node'),
    plural(diagram.edges.length, 'edge')].join(' · ');
  $('undo').disabled = !history.past.length;
  $('redo').disabled = !history.future.length;
  $('delete').disabled = !selected || selected.kind === 'lane';
  $('add-edge').disabled = !diagram.nodes.length;
  $('add-edge').setAttribute('aria-pressed', Boolean(connecting));
  setIndicator();
  paint();
  renderMetrics(diagram);
  if (inspector) renderInspector(diagram);
}

function setSelection(selection) {
  selected = selection;
  $('delete').disabled = !selection || selection.kind === 'lane';
  $('add-edge').setAttribute('aria-pressed', Boolean(connecting));
  paint();
  renderInspector(current());
}

function commit(diagram, options) {
  if (!history.commit(diagram)) return false;
  status();
  render(options);
  return true;
}

function replace(diagram, options = {}) {
  history.reset(diagram);
  savedId = options.savedId ?? null;
  cleanDiagram = diagram;
  exampleActive = Boolean(options.example);
  selected = null;
  connecting = null;
  render();
  fit();
}

function allowedToReplace() {
  return !isDirty() || window.confirm('Discard your unsaved changes?');
}

function updateView() {
  drawing.setAttribute('transform', `translate(${view.x} ${view.y}) scale(${view.scale})`);
  $('zoom-level').textContent = `${Math.round(view.scale * 100)}%`;
}

function fit() {
  const bounds = contentBounds(current());
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  const scale = Math.min(1.25, (width - 36) / bounds.width, (height - 28) / bounds.height);
  view = { scale, x: (width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (height - bounds.height * scale) / 2 - bounds.y * scale };
  viewAdjusted = false;
  updateView();
}

function zoom(multiple, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
  const scale = clamp(view.scale * multiple, Math.min(0.025, view.scale), 4);
  view = { scale, x: x - (x - view.x) * scale / view.scale, y: y - (y - view.y) * scale / view.scale };
  viewAdjusted = true;
  updateView();
}

function showDialog(title, contents, submitLabel, onSubmit) {
  $('dialog-title').textContent = title;
  $('dialog-content').replaceChildren(...contents);
  $('dialog-error').textContent = '';
  $('dialog-submit').hidden = !submitLabel;
  $('dialog-submit').textContent = submitLabel ?? '';
  submitDialog = onSubmit;
  dialog.showModal();
}

function promptLabel(title, initialValue, onSubmit) {
  const [label, input] = inputField('Name', initialValue);
  input.required = true;
  input.setAttribute('autofocus', '');
  showDialog(title, [label], 'Create', () => {
    if (!input.value.trim()) throw new Error('Enter a name.');
    onSubmit(input.value.trim());
  });
  input.select();
}

async function loadExample(id) {
  const token = ++operation;
  const initial = current();
  status('Loading example…');
  try {
    const url = new URL(`../examples/${id}.json`, import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The example could not be loaded (HTTP ${response.status}).`);
    const diagram = importDiagram(await response.text(), optimizeLayout);
    if (token !== operation || current() !== initial) return;
    replace(diagram, { example: true });
    status();
  } catch (error) {
    if (token === operation) status(error.message, true);
  }
}

function showExamples() {
  const list = document.createElement('div');
  list.className = 'choice-list';
  for (const [id, title, details] of EXAMPLES) {
    const choice = button(title, () => {
      dialog.close();
      if (allowedToReplace()) void loadExample(id);
    });
    const description = document.createElement('small');
    description.textContent = details;
    choice.append(description);
    list.append(choice);
  }
  showDialog('Load Example', [list]);
}

function showSaved() {
  try {
    const entries = repository.list();
    const list = document.createElement('div');
    list.className = 'choice-list';
    for (const entry of entries) {
      const choice = button(entry.title || 'Untitled diagram', () => {
        dialog.close();
        if (!allowedToReplace()) return;
        try {
          operation++;
          replace(repository.open(entry.id), { savedId: entry.id });
          status('Opened saved diagram.');
        } catch (error) {
          status(error.message, true);
        }
      });
      const time = document.createElement('small');
      time.textContent = new Date(entry.savedAt).toLocaleString();
      choice.append(time);
      list.append(choice);
    }
    if (!entries.length) list.textContent = 'Saved diagrams will appear here.';
    showDialog('Open Saved Diagram', [list]);
  } catch (error) {
    status(`Unable to open local storage. ${error.message}`, true);
  }
}

function save() {
  try {
    savedId = repository.save(savedId, current());
    cleanDiagram = current();
    setIndicator();
    status('Diagram saved in this browser.');
  } catch (error) {
    status(`Unable to save the diagram. ${error.message}`, true);
  }
}

function download() {
  try {
    const name = current().title.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'diagram';
    const url = URL.createObjectURL(new Blob([exportDiagram(current())], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Diagram exported.');
  } catch (error) {
    status(error.message, true);
  }
}

function autoLayout() {
  if (current().layout.manual && !window.confirm('Replace the manual arrangement with an automatic layout?')) return;
  connecting = null;
  selected = null;
  try {
    commit(optimizeLayout(current()).diagram);
    fit();
    status('Automatic layout applied.');
  } catch (error) {
    status(`Unable to arrange this diagram. ${error.message}`, true);
  }
}

function newNode() {
  const diagram = current();
  const item = selectedItem(diagram);
  const select = document.createElement('select');
  for (const lane of diagram.lanes) select.add(new Option(labelOf(lane), lane.id));
  select.value = selected?.kind === 'lane' ? item.id : item?.laneId ?? diagram.lanes[0].id;
  const [label, input] = inputField('Label', 'New activity');
  input.required = true;
  input.setAttribute('autofocus', '');
  showDialog('Add Node', [label, field('Swimlane', select)], 'Add Node', () => {
    if (!input.value.trim()) throw new Error('Enter a label.');
    const result = addNode(current(), select.value, input.value.trim());
    connecting = null;
    selected = { kind: 'node', id: result.id };
    commit(result.diagram);
    revealSelectedNode();
  });
  input.select();
}

function revealSelectedNode() {
  const node = selectedItem(current());
  const x = view.x + (node.x + node.width / 2) * view.scale;
  const y = view.y + (node.y + node.height / 2) * view.scale;
  if (x > 15 && x < viewport.clientWidth - 15 && y > 15 && y < viewport.clientHeight - 15) return;
  view.x += viewport.clientWidth / 2 - x;
  view.y += viewport.clientHeight / 2 - y;
  viewAdjusted = true;
  updateView();
}

function deleteSelection() {
  if (!selected) return;
  if (selected.waypoint !== undefined) {
    const { id, waypoint } = selected;
    selected = { kind: 'edge', id };
    commit(removeWaypoint(current(), id, waypoint));
    return;
  }
  const next = removeSelection(current(), selected);
  if (next !== current()) {
    selected = null;
    connecting = null;
    commit(next);
  }
}

function historyStep(direction) {
  connecting = null;
  if (selected?.waypoint !== undefined) selected = { kind: 'edge', id: selected.id };
  history[direction]();
  status();
  render();
}

function beginConnection() {
  if (connecting) {
    connecting = null;
  } else {
    connecting = { source: selected?.kind === 'node' ? selected.id : null };
  }
  setSelection(selected);
}

function connectNode(id) {
  if (!connecting.source) {
    connecting = { source: id };
    setSelection({ kind: 'node', id });
    return;
  }
  const result = addEdge(current(), connecting.source, id);
  connecting = null;
  selected = { kind: 'edge', id: result.id };
  commit(result.diagram);
}

function pointerDown(event) {
  if (gesture || (event.button !== 0 && event.button !== 1)) return;
  const control = event.button === 1 ? null : event.target.closest('[data-kind]');
  const { kind = 'pan', id, index } = control?.dataset ?? {};
  viewport.focus({ preventScroll: true });
  if (connecting && kind === 'node') {
    event.preventDefault();
    connectNode(id);
    return;
  }
  if (kind === 'edge') {
    setSelection({ kind, id });
    return;
  }
  if (kind === 'pan' && event.button === 0 && !connecting) setSelection(null);
  if (['node', 'lane', 'resize'].includes(kind)) setSelection({ kind: kind === 'node' ? 'node' : 'lane', id });
  if (['waypoint', 'segment'].includes(kind)) setSelection({ kind: 'edge', id, ...(kind === 'waypoint' ? { waypoint: +index } : {}) });

  gesture = {
    pointerId: event.pointerId, kind, id, index: index === undefined ? null : Number(index),
    clientX: event.clientX, clientY: event.clientY, view: { ...view }, base: current(), preview: current(),
    active: false,
  };
  viewport.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function pointerMove(event) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  if (event.pointerType === 'mouse' && !event.buttons) {
    pointerEnd(event, true);
    return;
  }
  const { kind, id, base, index } = gesture;
  const screenX = event.clientX - gesture.clientX;
  const screenY = event.clientY - gesture.clientY;
  if (!gesture.active && Math.hypot(screenX, screenY) < 3) return;
  gesture.active = true;
  viewport.classList.add('is-dragging');
  const dx = screenX / view.scale;
  const dy = screenY / view.scale;
  let next = base;
  if (kind === 'pan') {
    view.x = gesture.view.x + screenX;
    view.y = gesture.view.y + screenY;
    viewAdjusted = true;
    updateView();
    return;
  }
  if (kind === 'node') {
    const node = base.nodes.find((item) => item.id === id);
    next = moveNode(base, id, node.x + dx, node.y + dy);
  }
  if (kind === 'resize') {
    const lane = base.lanes.find((item) => item.id === id);
    next = resizeLane(base, id, lane.width + dx);
  }
  if (kind === 'lane') {
    const from = base.lanes.findIndex((lane) => lane.id === id);
    const lane = base.lanes[from];
    const center = lane.x + lane.width / 2 + dx;
    let to = from;
    while (to > 0 && center < base.lanes[to - 1].x + base.lanes[to - 1].width / 2) to--;
    while (to < base.lanes.length - 1 && center > base.lanes[to + 1].x + base.lanes[to + 1].width / 2) to++;
    next = reorderLane(base, id, to);
  }
  if (kind === 'waypoint' || kind === 'segment') {
    const route = base.edges.find((edge) => edge.id === id).route;
    const a = route[index];
    if (kind === 'waypoint') next = moveWaypoint(base, id, index, { x: a.x + dx, y: a.y + dy });
    else {
      const b = route[index + 1];
      next = moveSegment(base, id, index, b.y === a.y ? 0 : dx, b.x === a.x ? 0 : dy);
    }
  }
  gesture.preview = next;
  paint(next);
}

function pointerEnd(event, canceled) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  const { kind, preview } = gesture;
  gesture = null;
  viewport.classList.remove('is-dragging');
  if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  if (kind !== 'pan' && (canceled || !commit(preview))) paint();
}

function bind() {
  $('new').onclick = () => {
    if (allowedToReplace()) promptLabel('New Diagram', 'Untitled diagram', (title) => {
      operation++;
      replace(blankDiagram(title));
      status();
    });
  };
  $('open').onclick = showSaved;
  $('examples').onclick = showExamples;
  $('import').onclick = () => $('file-input').click();
  $('save').onclick = save;
  $('export').onclick = download;
  $('auto-layout').onclick = autoLayout;
  $('add-node').onclick = newNode;
  $('add-edge').onclick = beginConnection;
  $('add-lane').onclick = () => promptLabel('Add Swimlane', 'New swimlane', (label) => {
    const result = addLane(current(), label);
    selected = { kind: 'lane', id: result.id };
    commit(result.diagram);
    fit();
  });
  $('delete').onclick = deleteSelection;
  $('undo').onclick = () => historyStep('undo');
  $('redo').onclick = () => historyStep('redo');
  $('zoom-in').onclick = () => zoom(1.2);
  $('zoom-out').onclick = () => zoom(1 / 1.2);
  $('fit').onclick = fit;
  $('dialog-close').onclick = $('dialog-cancel').onclick = () => dialog.close();
  $('dialog-form').onsubmit = (event) => {
    event.preventDefault();
    try {
      submitDialog?.();
      dialog.close();
    } catch (error) {
      $('dialog-error').textContent = error.message;
    }
  };
  $('file-input').onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      const initial = current();
      const token = ++operation;
      const diagram = importDiagram(await file.text(), optimizeLayout);
      if (current() !== initial || token !== operation || !allowedToReplace()) return;
      replace(diagram);
      status(`Imported ${file.name}.`);
    } catch (error) {
      status(`Import failed. ${error.message}`, true);
    }
  };

  viewport.addEventListener('pointerdown', pointerDown);
  window.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', (event) => pointerEnd(event, false));
  window.addEventListener('pointercancel', (event) => pointerEnd(event, true));
  window.addEventListener('blur', () => {
    if (gesture) pointerEnd({ pointerId: gesture.pointerId }, true);
  });
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoom(Math.exp(-clamp(event.deltaY, -150, 150) * 0.004), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  new ResizeObserver(() => { if (!viewAdjusted && !gesture) fit(); }).observe(viewport);
  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = true;
  });
  document.addEventListener('keydown', (event) => {
    if (dialog.open || event.target.matches('input, select, textarea') || gesture) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 's') { event.preventDefault(); save(); }
    if (modifier && (key === 'z' || key === 'y')) {
      event.preventDefault();
      historyStep(key === 'y' || event.shiftKey ? 'redo' : 'undo');
    }
    if (key === 'delete' || key === 'backspace') { event.preventDefault(); deleteSelection(); }
    if (key === 'escape') { connecting = null; setSelection(null); }
  });
}

addIcons(document);
render();
fit();
try {
  repository = new DiagramStorage(window.localStorage);
  const recent = repository.last();
  if (recent) replace(recent.diagram, { savedId: recent.id });
  else await loadExample('fulfillment');
} catch (error) {
  render();
  fit();
  status(`Unable to restore local storage. ${error.message}`, true);
}
bind();
