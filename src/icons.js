const paths = {
  'file-plus': 'M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10zm0 0v7h7m-8 3v5m-2.5-2.5h5',
  folder: 'M3 18V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z',
  layers: 'm12 3 9 5-9 5-9-5zm-9 9 9 5 9-5m-18 4 9 5 9-5',
  upload: 'M12 15V3m-4 4 4-4 4 4M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  download: 'M12 3v12m-4-4 4 4 4-4M4 14v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  save: 'M4 4h13l3 3v13H4zM8 4v6h8V4m-8 16v-6h8v6',
  node: 'M3 5h18v14H3zM12 9v6m-3-3h6',
  edge: 'M5 19h4v-6h6V6h4m-3-3 3 3-3 3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13m-8 4v5m4-5v5',
  undo: 'm8 5-5 5 5 5m-5-5h11a5 5 0 0 1 5 5v3',
  redo: 'm16 5 5 5-5 5m5-5H10a5 5 0 0 0-5 5v3',
  arrange: 'M3 3h7v5H3zm11 13h7v5h-7zM6.5 8v10.5H14m2-15.5v7m-3-3h6',
  lane: 'M3 5h18v14H3zm6 0v14m6-10v6m-3-3h6',
  minus: 'M5 12h14',
  plus: 'M5 12h14m-7-7v14',
  fit: 'M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5',
  chart: 'M4 20h16M7 16v-4m5 4V8m5 8V4',
  sliders: 'M4 7h5m5 0h6M4 17h10m5 0h1M9 4v6m10 4v6',
  close: 'm6 6 12 12M18 6 6 18',
  cursor: 'm5 3 14 10-7 1-3 6z',
};

export function addIcons(root) {
  for (const element of root.querySelectorAll('[data-icon]')) {
    const name = element.dataset.icon;
    if (!paths[name]) continue;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', paths[name]);
    svg.append(path);
    element.prepend(svg);
  }
}
