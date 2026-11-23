import test from 'node:test';
import assert from 'node:assert/strict';
import { boardDocumentSchema, emptyDocument, makeElement, makePreset, elementBounds, sceneBounds, hitTest, pickElement, serializeSvg } from '../shared/whiteboard.js';
import { whiteboardSchema } from '../server/validation.js';

test('all competitive-programming presets are valid editable documents', () => {
  for (const type of ['array', 'tree', 'graph']) {
    const document = { ...emptyDocument(), elements: makePreset(type, { x: 400, y: 250 }) };
    assert.ok(boardDocumentSchema.safeParse(document).success, type);
    assert.equal(new Set(document.elements.map(e => e.id)).size, document.elements.length);
    assert.ok(document.elements.some(e => e.type === 'text'));
    assert.ok(sceneBounds(document.elements).width > 0);
  }
});
test('bounds normalize reverse-drawn shapes and account for freehand offsets and multiline labels', () => {
  assert.deepEqual(elementBounds(makeElement('rectangle', 100, 100, { width: -60, height: -40 })), { x: 40, y: 60, width: 60, height: 40 });
  assert.deepEqual(elementBounds(makeElement('pen', 20, 30, { points: [{ x: -5, y: 10 }, { x: 20, y: -10 }] })), { x: 15, y: 20, width: 25, height: 20 });
  const text = elementBounds(makeElement('text', 0, 0, { text: 'dist[u]\n= dist[v] + w' }));
  assert.equal(text.height, 24 * 1.35 * 2); assert.ok(text.width > 100);
});
test('selection chooses the top element and erasing does not delete the empty interior of shapes', () => {
  const rectangle = makeElement('rectangle', 0, 0, { width: 100, height: 100 });
  const ellipse = makeElement('ellipse', 0, 0, { width: 100, height: 100 });
  assert.equal(pickElement([rectangle, ellipse], { x: 50, y: 50 }).id, ellipse.id);
  assert.ok(hitTest(rectangle, { x: 50, y: 50 }));
  assert.ok(!hitTest(rectangle, { x: 50, y: 50 }, 5, false));
  assert.ok(hitTest(rectangle, { x: 0, y: 50 }, 5, false));
  assert.ok(!hitTest(ellipse, { x: 50, y: 50 }, 5, false));
  assert.ok(hitTest(ellipse, { x: 50, y: 0 }, 5, false));
  assert.ok(hitTest(makeElement('arrow', 0, 0, { width: 100, height: 100 }), { x: 50, y: 50 }));
});
test('SVG export escapes labels and exports arrows and freehand strokes without executable content', () => {
  const document = { ...emptyDocument(), elements: [
    makeElement('text', 0, 0, { text: '<script>alert("x")</script>\na & b' }),
    makeElement('arrow', 0, 100, { width: 100, height: 20 }),
    makeElement('pen', 20, 20, { points: [{ x: 0, y: 0 }, { x: 5, y: 10 }] }),
  ] };
  const svg = serializeSvg(document);
  assert.ok(svg.includes('&lt;script&gt;')); assert.ok(svg.includes('a &amp; b'));
  assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('onload='));
  assert.ok(svg.includes('polyline')); assert.ok(svg.includes('viewBox='));
});
test('import and account-save validation reject oversized or unsafe documents', () => {
  const document = emptyDocument();
  const element = makeElement('rectangle', 0, 0, { width: 10, height: 10 });
  assert.ok(!boardDocumentSchema.safeParse({ ...document, elements: [element, element] }).success);
  assert.ok(!boardDocumentSchema.safeParse({ ...document, elements: [{ ...element, color: 'url(javascript:alert(1))' }] }).success);
  assert.ok(!boardDocumentSchema.safeParse({ ...document, elements: [{ ...element, x: Infinity }] }).success);
  assert.ok(!boardDocumentSchema.safeParse({ ...document, elements: [{ ...element, type: 'foreignObject' }] }).success);
  assert.ok(!boardDocumentSchema.safeParse({ ...document, version: 2 }).success);
  assert.ok(!boardDocumentSchema.safeParse({ ...document, elements: Array.from({ length: 401 }, () => ({ ...element, id: crypto.randomUUID() })) }).success);
  assert.ok(whiteboardSchema.safeParse({ title: 'DFS trace', document }).success);
  assert.ok(!whiteboardSchema.safeParse({ title: '', document }).success);
});
