import { z } from 'zod';

export const MAX_ELEMENTS = 400;
export const MAX_POINTS = 12000;
export const GRID_SIZE = 20;
const coordinate = z.number().min(-20000).max(20000);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const boardElementSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['pen', 'rectangle', 'ellipse', 'line', 'arrow', 'text']),
  x: coordinate, y: coordinate, width: coordinate, height: coordinate,
  color, fill: z.union([color, z.literal('none')]),
  strokeWidth: z.number().min(1).max(12), fontSize: z.number().min(12).max(72),
  text: z.string().max(2000),
  points: z.array(z.object({ x: coordinate, y: coordinate })).max(2000),
}).superRefine((element, ctx) => {
  if (element.type === 'pen' && !element.points.length) ctx.addIssue({ code: 'custom', message: 'A pen stroke must contain points.' });
  if (element.type === 'text' && !element.text.trim()) ctx.addIssue({ code: 'custom', message: 'A text label cannot be empty.' });
});
export const boardDocumentSchema = z.object({
  version: z.literal(1),
  elements: z.array(boardElementSchema).max(MAX_ELEMENTS),
  background: z.enum(['dots', 'grid', 'plain']),
  snap: z.boolean(),
}).superRefine((document, ctx) => {
  if (new Set(document.elements.map(e => e.id)).size !== document.elements.length) ctx.addIssue({ code: 'custom', message: 'Element IDs must be unique.' });
  if (document.elements.reduce((n, e) => n + e.points.length, 0) > MAX_POINTS) ctx.addIssue({ code: 'custom', message: `A board supports up to ${MAX_POINTS.toLocaleString('en-US')} stroke points.` });
  if (new TextEncoder().encode(JSON.stringify(document)).byteLength > 400000) ctx.addIssue({ code: 'custom', message: 'This board is too large. Remove some elements or split it into separate boards.' });
});

export function emptyDocument() { return { version: 1, elements: [], background: 'dots', snap: false }; }
export function elementBounds(element) {
  if (element.type === 'pen') {
    const xs = element.points.map(p => p.x + element.x), ys = element.points.map(p => p.y + element.y);
    return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  if (element.type === 'text') {
    const lines = element.text.split('\n');
    return { x: element.x, y: element.y, width: Math.max(...lines.map(line => [...line].length), 1) * element.fontSize * 0.64, height: lines.length * element.fontSize * 1.35 };
  }
  return { x: Math.min(element.x, element.x + element.width), y: Math.min(element.y, element.y + element.height), width: Math.abs(element.width), height: Math.abs(element.height) };
}
export function sceneBounds(elements, padding = 32) {
  if (!elements.length) return { x: 0, y: 0, width: 800, height: 500 };
  const bounds = elements.map(elementBounds);
  const x = Math.min(...bounds.map(b => b.x)), y = Math.min(...bounds.map(b => b.y));
  return { x: x - padding, y: y - padding, width: Math.max(80, Math.max(...bounds.map(b => b.x + b.width)) - x + padding * 2), height: Math.max(80, Math.max(...bounds.map(b => b.y + b.height)) - y + padding * 2) };
}
export function segmentDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy);
}
export function hitTest(element, point, tolerance = 6, interior = true) {
  const b = elementBounds(element), margin = tolerance + element.strokeWidth / 2;
  if (point.x < b.x - margin || point.x > b.x + b.width + margin || point.y < b.y - margin || point.y > b.y + b.height + margin) return false;
  if (element.type === 'pen') {
    return element.points.some((p, i) => segmentDistance(point, { x: p.x + element.x, y: p.y + element.y }, { x: (element.points[i - 1] || p).x + element.x, y: (element.points[i - 1] || p).y + element.y }) <= margin);
  }
  if (element.type === 'line' || element.type === 'arrow') return segmentDistance(point, element, { x: element.x + element.width, y: element.y + element.height }) <= margin;
  if (element.type === 'text') return true;
  if (element.type === 'ellipse') {
    const rx = Math.max(1, b.width / 2), ry = Math.max(1, b.height / 2);
    const radius = Math.hypot((point.x - b.x - rx) / rx, (point.y - b.y - ry) / ry);
    return interior || element.fill !== 'none' ? radius <= 1 + margin / Math.min(rx, ry) : Math.abs(radius - 1) <= margin / Math.min(rx, ry);
  }
  return interior || element.fill !== 'none' || point.x <= b.x + margin || point.x >= b.x + b.width - margin || point.y <= b.y + margin || point.y >= b.y + b.height - margin;
}
export function pickElement(elements, point, tolerance = 6, interior = true) {
  return [...elements].reverse().find(element => hitTest(element, point, tolerance, interior)) || null;
}
export function arrowHead(element) {
  const x = element.x + element.width, y = element.y + element.height;
  const angle = Math.atan2(element.height, element.width), size = Math.max(10, element.strokeWidth * 4);
  return `${x - size * Math.cos(angle - Math.PI / 6)},${y - size * Math.sin(angle - Math.PI / 6)} ${x},${y} ${x - size * Math.cos(angle + Math.PI / 6)},${y - size * Math.sin(angle + Math.PI / 6)}`;
}

export function makeElement(type, x, y, options = {}) {
  return { id: crypto.randomUUID(), type, x, y, width: 0, height: 0, color: '#3b82f6', fill: 'none', strokeWidth: 2, fontSize: 24, text: '', points: [], ...options };
}
export function makePreset(type, center) {
  const elements = [], edge = '#8291a8', text = '#3b82f6';
  if (type === 'array') {
    for (let i = 0; i < 6; i++) {
      const x = center.x - 204 + i * 68, y = center.y - 34;
      elements.push(makeElement('rectangle', x, y, { width: 68, height: 68, color: edge }));
      elements.push(makeElement('text', x + 24, y + 18, { text: String([4, 1, 7, 3, 9, 2][i]), color: text }));
      elements.push(makeElement('text', x + 27, y + 78, { text: String(i), fontSize: 14, color: edge }));
    }
  } else {
    const nodes = type === 'tree' ? [[0, -120], [-125, -15], [125, -15], [-190, 100], [-65, 100], [65, 100], [190, 100]] : [[-150, -90], [20, -120], [170, -10], [60, 115], [-130, 100]];
    const edges = type === 'tree' ? [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6]] : [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 3]];
    for (const [a, b] of edges) {
      const from = nodes[a], to = nodes[b], dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy), offset = 28;
      elements.push(makeElement(type === 'graph' ? 'arrow' : 'line', center.x + from[0] + dx / length * offset, center.y + from[1] + dy / length * offset, { width: dx * (1 - 2 * offset / length), height: dy * (1 - 2 * offset / length), color: edge }));
    }
    nodes.forEach(([x, y], i) => {
      elements.push(makeElement('ellipse', center.x + x - 28, center.y + y - 28, { width: 56, height: 56, color: text }));
      elements.push(makeElement('text', center.x + x - 8, center.y + y - 16, { text: String(i + 1), color: text }));
    });
  }
  return elements;
}
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function serializeSvg(document, background = '#ffffff') {
  const bounds = sceneBounds(document.elements);
  const body = document.elements.map(e => {
    const b = elementBounds(e);
    const style = `stroke="${escapeXml(e.color)}" stroke-width="${e.strokeWidth}" fill="${escapeXml(e.fill)}" stroke-linecap="round" stroke-linejoin="round"`;
    if (e.type === 'text') return `<text fill="${escapeXml(e.color)}" font-family="monospace" font-size="${e.fontSize}">${e.text.split('\n').map((line, i) => `<tspan x="${e.x}" y="${e.y + e.fontSize + i * e.fontSize * 1.35}">${escapeXml(line)}</tspan>`).join('')}</text>`;
    if (e.type === 'pen') return e.points.length === 1 ? `<circle cx="${e.x + e.points[0].x}" cy="${e.y + e.points[0].y}" r="${e.strokeWidth / 2}" fill="${escapeXml(e.color)}"/>` : `<polyline points="${e.points.map(p => `${p.x + e.x},${p.y + e.y}`).join(' ')}" ${style} fill-opacity="0"/>`;
    if (e.type === 'rectangle') return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" ${style}/>`;
    if (e.type === 'ellipse') return `<ellipse cx="${b.x + b.width / 2}" cy="${b.y + b.height / 2}" rx="${b.width / 2}" ry="${b.height / 2}" ${style}/>`;
    return `<line x1="${e.x}" y1="${e.y}" x2="${e.x + e.width}" y2="${e.y + e.height}" ${style}/>${e.type === 'arrow' ? `<polyline points="${arrowHead(e)}" ${style} fill-opacity="0"/>` : ''}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(background)}"/>${body}</svg>`;
}
