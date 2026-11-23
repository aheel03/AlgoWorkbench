import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MousePointer2, Pencil, Eraser, Square, Circle, Minus, MoveUpRight, Type, Hand, Undo2, Redo2, Trash2, Copy, ZoomIn, ZoomOut, Scan, Save, FolderOpen, FilePlus2, Download, Upload, Grid2X2, Check, LoaderCircle } from 'lucide-react';
import { boardDocumentSchema, emptyDocument, elementBounds, sceneBounds, pickElement, arrowHead, makeElement, makePreset, serializeSvg, MAX_ELEMENTS, GRID_SIZE, type BoardDocument, type BoardElement, type ElementType, type Point } from '../shared/whiteboard.js';
import { ErrorBox, Modal } from './components';
import { api, download, errorMessage } from './lib';
import { useTheme } from './theme';
import type { AppContext } from './types';
import './whiteboard.css';

type Tool = ElementType | 'select' | 'eraser' | 'pan';
type View = { x: number; y: number; zoom: number };
type Draft = { id?: string; title: string; document: BoardDocument; view: View };
type SavedBoard = { id: string; title: string; document: BoardDocument; updated_at: string };
type BoardItem = Pick<SavedBoard, 'id' | 'title' | 'updated_at'>;
type Gesture = { kind: 'draw' | 'move' | 'pan' | 'erase'; pointerId: number; start: Point; before: BoardDocument; element?: BoardElement; original?: BoardElement; view: View; removed: Set<string> };
const defaultView = { x: 0, y: 0, zoom: 1 };
const tools = [
  { id: 'select', label: 'Select', key: 'V', icon: MousePointer2 },
  { id: 'pen', label: 'Pen', key: 'P', icon: Pencil },
  { id: 'eraser', label: 'Eraser', key: 'E', icon: Eraser },
  { id: 'rectangle', label: 'Rectangle', key: 'R', icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', icon: Circle },
  { id: 'line', label: 'Line', key: 'L', icon: Minus },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: MoveUpRight },
  { id: 'text', label: 'Text', key: 'T', icon: Type },
  { id: 'pan', label: 'Pan', key: 'H', icon: Hand },
] as const;
const palette = ['#3b82f6', '#22a16b', '#e76b45', '#9b6de3', '#ec4899', '#8291a8'];
const bounded = (value: number) => Math.max(-15000, Math.min(15000, value));
const snapped = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;
const signature = (draft: Pick<Draft, 'title' | 'document'>) => JSON.stringify([draft.title, draft.document]);

function loadDraft(owner: string): Draft {
  const fallback: Draft = { title: 'Untitled board', document: emptyDocument(), view: defaultView };
  try {
    const value = JSON.parse(localStorage.getItem(`awb-whiteboard-${owner}`) || 'null');
    if (!value) return fallback;
    const parsed = boardDocumentSchema.safeParse(value.document);
    if (!parsed.success) return fallback;
    const view = value.view;
    return { id: typeof value.id === 'string' ? value.id : undefined, title: typeof value.title === 'string' ? value.title.slice(0, 100) : fallback.title, document: parsed.data, view: view && [view.x, view.y, view.zoom].every(Number.isFinite) ? { x: view.x, y: view.y, zoom: Math.min(3, Math.max(0.2, view.zoom)) } : defaultView };
  } catch { return fallback; }
}

function ElementView({ element: e }: { element: BoardElement }) {
  const b = elementBounds(e);
  const style = { stroke: e.color, strokeWidth: e.strokeWidth, fill: e.fill, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (e.type === 'text') return <text fill={e.color} fontFamily="monospace" fontSize={e.fontSize}>{e.text.split('\n').map((line, i) => <tspan key={i} x={e.x} y={e.y + e.fontSize + i * e.fontSize * 1.35}>{line || ' '}</tspan>)}</text>;
  if (e.type === 'pen') return e.points.length === 1 ? <circle cx={e.x + e.points[0].x} cy={e.y + e.points[0].y} r={e.strokeWidth / 2} fill={e.color} /> : <polyline points={e.points.map(p => `${p.x + e.x},${p.y + e.y}`).join(' ')} {...style} fill="none" />;
  if (e.type === 'rectangle') return <rect x={b.x} y={b.y} width={b.width} height={b.height} {...style} />;
  if (e.type === 'ellipse') return <ellipse cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} {...style} />;
  return <><line x1={e.x} y1={e.y} x2={e.x + e.width} y2={e.y + e.height} {...style} />{e.type === 'arrow' && <polyline points={arrowHead(e)} {...style} fill="none" />}</>;
}

export function Whiteboard({ ctx, active }: { ctx: AppContext; active: boolean }) {
  const { theme } = useTheme();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(ctx.owner));
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(palette[0]);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fill, setFill] = useState(false);
  const [fontSize, setFontSize] = useState(24);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Gesture | null>(null);
  const [past, setPast] = useState<BoardDocument[]>([]);
  const [future, setFuture] = useState<BoardDocument[]>([]);
  const [space, setSpace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localStatus, setLocalStatus] = useState('Draft saved locally');
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [pendingReplace, setPendingReplace] = useState<(() => void) | null>(null);
  const [textEdit, setTextEdit] = useState<{ position: Point; value: string; element?: BoardElement } | null>(null);
  const surface = useRef<SVGSVGElement>(null);
  const importer = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const revision = useRef(0);
  const state = useRef(draft); state.current = draft;
  const gridId = useId().replace(/:/g, '');
  const board = draft.document;
  const selectedElement = board.elements.find(e => e.id === selected);
  const modified = signature(draft) !== savedSignature;

  useEffect(() => {
    setLocalStatus('Saving draft…');
    const timer = setTimeout(() => {
      try { localStorage.setItem(`awb-whiteboard-${ctx.owner}`, JSON.stringify(draft)); setLocalStatus('Draft saved locally'); }
      catch { setLocalStatus('Browser storage unavailable — export to keep a copy'); }
    }, 350);
    return () => clearTimeout(timer);
  }, [draft, ctx.owner]);

  function commit(document: BoardDocument) {
    const valid = boardDocumentSchema.safeParse(document);
    if (!valid.success) { setError(valid.error.issues[0]?.message || 'This board is too large.'); return; }
    if (JSON.stringify(document) === JSON.stringify(state.current.document)) return;
    const before = state.current.document;
    setPast(history => [...history.slice(-39), before]); setFuture([]);
    setDraft(current => ({ ...current, document: valid.data })); setError(null);
  }
  function undo() {
    if (!past.length) return;
    const previous = past[past.length - 1];
    setFuture(items => [state.current.document, ...items].slice(0, 40)); setPast(items => items.slice(0, -1));
    setDraft(current => ({ ...current, document: previous })); setSelected(null);
  }
  function redo() {
    if (!future.length) return;
    setPast(items => [...items, state.current.document].slice(-40));
    setDraft(current => ({ ...current, document: future[0] })); setFuture(items => items.slice(1)); setSelected(null);
  }
  function removeSelected() {
    if (!selected) return; commit({ ...board, elements: board.elements.filter(e => e.id !== selected) }); setSelected(null);
  }
  function duplicate() {
    if (!selectedElement) return;
    const copy = { ...selectedElement, id: crypto.randomUUID(), x: selectedElement.x + 24, y: selectedElement.y + 24 };
    commit({ ...board, elements: [...board.elements, copy] }); setSelected(copy.id);
  }
  function changeStyle(change: Partial<BoardElement>) {
    if (selectedElement) commit({ ...board, elements: board.elements.map(e => e.id === selected ? { ...e, ...change } : e) });
  }
  function world(event: { clientX: number; clientY: number }, view = state.current.view): Point {
    const rect = surface.current!.getBoundingClientRect();
    return { x: bounded((event.clientX - rect.left - view.x) / view.zoom), y: bounded((event.clientY - rect.top - view.y) / view.zoom) };
  }
  function snap(point: Point): Point { return board.snap ? { x: snapped(point.x), y: snapped(point.y) } : point; }
  function zoom(factor: number, point?: Point) {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    const anchor = point || { x: rect.width / 2, y: rect.height / 2 };
    setDraft(current => {
      const next = Math.max(0.2, Math.min(3, current.view.zoom * factor));
      const ratio = next / current.view.zoom;
      return { ...current, view: { zoom: next, x: anchor.x - (anchor.x - current.view.x) * ratio, y: anchor.y - (anchor.y - current.view.y) * ratio } };
    });
  }
  function fitted(document: BoardDocument): View {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || !document.elements.length) return defaultView;
    const bounds = sceneBounds(document.elements, 55);
    const next = Math.max(0.2, Math.min(1.5, rect.width / bounds.width, rect.height / bounds.height));
    return { zoom: next, x: (rect.width - bounds.width * next) / 2 - bounds.x * next, y: (rect.height - bounds.height * next) / 2 - bounds.y * next };
  }
  function fit() { setDraft(current => ({ ...current, view: fitted(current.document) })); }

  useEffect(() => {
    if (!active) return;
    const canvas = surface.current;
    if (!canvas) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) zoom(Math.exp(-event.deltaY * 0.008), { x: event.clientX - rect.left, y: event.clientY - rect.top });
      else setDraft(current => ({ ...current, view: { ...current.view, x: current.view.x - event.deltaX, y: current.view.y - event.deltaY } }));
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [active]);

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (gesture.current || event.button > 1) return;
    event.preventDefault(); surface.current?.focus();
    const point = world(event);
    const operation: Gesture = { kind: 'draw', pointerId: event.pointerId, start: point, before: board, view: draft.view, removed: new Set() };
    if (space || tool === 'pan' || event.button === 1) operation.kind = 'pan';
    else if (tool === 'select') {
      const hit = pickElement(board.elements, point, 7 / draft.view.zoom);
      setSelected(hit?.id || null);
      if (!hit) return;
      operation.kind = 'move'; operation.original = hit; operation.element = hit;
    } else if (tool === 'eraser') {
      operation.kind = 'erase';
      const hit = pickElement(board.elements, point, 8 / draft.view.zoom, false);
      if (hit) operation.removed.add(hit.id);
    } else if (tool === 'text') {
      setTextEdit({ position: snap(point), value: '' }); return;
    } else {
      if (board.elements.length >= MAX_ELEMENTS) { setError(`A board supports up to ${MAX_ELEMENTS} elements.`); return; }
      const start = tool === 'pen' ? point : snap(point);
      operation.start = start;
      operation.element = makeElement(tool, start.x, start.y, { color, strokeWidth, fill: fill && ['rectangle', 'ellipse'].includes(tool) ? color : 'none', fontSize, points: tool === 'pen' ? [{ x: 0, y: 0 }] : [] });
      setSelected(null);
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = operation; setPreview({ ...operation });
  }
  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const operation = gesture.current;
    if (!operation || operation.pointerId !== event.pointerId) return;
    if (operation.kind === 'pan') {
      const rect = surface.current!.getBoundingClientRect();
      setDraft(current => ({ ...current, view: { ...operation.view, x: event.clientX - rect.left - operation.start.x * operation.view.zoom, y: event.clientY - rect.top - operation.start.y * operation.view.zoom } })); return;
    }
    const point = world(event);
    if (operation.kind === 'erase') {
      const hit = pickElement(board.elements.filter(e => !operation.removed.has(e.id)), point, 8 / draft.view.zoom, false);
      if (hit) operation.removed.add(hit.id);
    } else if (operation.kind === 'move' && operation.original) {
      let dx = point.x - operation.start.x, dy = point.y - operation.start.y;
      if (board.snap) { dx = snapped(dx); dy = snapped(dy); }
      operation.element = { ...operation.original, x: bounded(operation.original.x + dx), y: bounded(operation.original.y + dy) };
    } else if (operation.element) {
      const element = operation.element;
      if (element.type === 'pen') {
        const relative = { x: point.x - element.x, y: point.y - element.y };
        const last = element.points[element.points.length - 1];
        if (Math.hypot(relative.x - last.x, relative.y - last.y) > 1.5 / draft.view.zoom && element.points.length < 2000) operation.element = { ...element, points: [...element.points, relative] };
      } else {
        const end = snap(point);
        let width = end.x - operation.start.x, height = end.y - operation.start.y;
        if (event.shiftKey) {
          if (['rectangle', 'ellipse'].includes(element.type)) { const size = Math.max(Math.abs(width), Math.abs(height)); width = (width < 0 ? -1 : 1) * size; height = (height < 0 ? -1 : 1) * size; }
          else { const angle = Math.round(Math.atan2(height, width) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(width, height); width = Math.cos(angle) * length; height = Math.sin(angle) * length; }
        }
        operation.element = { ...element, width, height };
      }
    }
    setPreview({ ...operation, removed: new Set(operation.removed) });
  }
  function pointerUp(event: ReactPointerEvent<SVGSVGElement>) {
    const operation = gesture.current;
    if (!operation || event.pointerId !== operation.pointerId) return;
    if (operation.kind === 'erase' && operation.removed.size) commit({ ...board, elements: board.elements.filter(e => !operation.removed.has(e.id)) });
    else if (operation.kind === 'move' && operation.element) commit({ ...board, elements: board.elements.map(e => e.id === operation.element!.id ? operation.element! : e) });
    else if (operation.kind === 'draw' && operation.element) {
      const e = operation.element;
      const visible = e.type === 'pen' || (['rectangle', 'ellipse'].includes(e.type) ? Math.abs(e.width) > 2 && Math.abs(e.height) > 2 : Math.hypot(e.width, e.height) > 3);
      if (visible) commit({ ...board, elements: [...board.elements, e] });
    }
    gesture.current = null; setPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function submitText() {
    if (!textEdit?.value.trim()) return;
    const element = textEdit.element ? { ...textEdit.element, text: textEdit.value } : makeElement('text', textEdit.position.x, textEdit.position.y, { color, fontSize, text: textEdit.value });
    commit({ ...board, elements: textEdit.element ? board.elements.map(e => e.id === element.id ? element : e) : [...board.elements, element] });
    setSelected(element.id); setTool('select'); setTextEdit(null);
  }
  function insertPreset(type: 'array' | 'tree' | 'graph') {
    const rect = surface.current!.getBoundingClientRect();
    const center = { x: (rect.width / 2 - draft.view.x) / draft.view.zoom, y: (rect.height / 2 - draft.view.y) / draft.view.zoom };
    commit({ ...board, elements: [...board.elements, ...makePreset(type, center)] }); setSelected(null); setTool('select');
  }
  function replace(action: () => void) {
    if (board.elements.length && modified) setPendingReplace(() => action); else action();
  }
  function reset(next: Draft) { revision.current++; setDraft(next); setPast([]); setFuture([]); setSelected(null); setError(null); setSavedSignature(null); }
  async function save() {
    if (!ctx.requireAuth()) return;
    if (!draft.title.trim()) { setError('Enter a board name before saving.'); return; }
    setSaving(true); setError(null);
    const snapshot = draft;
    const savedRevision = revision.current;
    try {
      const saved = await api<SavedBoard>(ctx, '/whiteboards', { method: 'POST', body: JSON.stringify({ id: snapshot.id, title: snapshot.title.trim(), document: snapshot.document }) });
      if (revision.current === savedRevision) { setDraft(current => ({ ...current, id: saved.id, title: current.title === snapshot.title ? saved.title : current.title })); setSavedSignature(signature({ title: saved.title, document: saved.document })); }
      ctx.notify('Whiteboard saved to your account.');
    } catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }
  async function listBoards() {
    if (!ctx.requireAuth()) return; setBoardsOpen(true); setLoading(true); setError(null);
    try { setBoards(await api<BoardItem[]>(ctx, '/whiteboards')); } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }
  async function openBoard(id: string) {
    setLoading(true);
    try {
      const saved = await api<SavedBoard>(ctx, `/whiteboards/${id}`);
      const parsed = boardDocumentSchema.safeParse(saved.document);
      if (!parsed.success) throw new Error('This saved board has an unsupported format.');
      setBoardsOpen(false);
      replace(() => { const next = { id: saved.id, title: saved.title, document: parsed.data, view: fitted(parsed.data) }; reset(next); setSavedSignature(signature(next)); });
    } catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }
  async function deleteBoard() {
    if (!deleteId) return; setLoading(true);
    try { await api(ctx, `/whiteboards/${deleteId}`, { method: 'DELETE' }); setBoards(items => items.filter(b => b.id !== deleteId)); if (draft.id === deleteId) setDraft(current => ({ ...current, id: undefined })); setDeleteId(null); ctx.notify('Whiteboard deleted.'); }
    catch (e) { setError(errorMessage(e)); } finally { setLoading(false); }
  }
  async function importBoard(file?: File) {
    if (!file) return;
    try {
      if (file.size > 450000) throw new Error('The JSON file must be smaller than 450 KB.');
      const value = JSON.parse(await file.text());
      const parsed = boardDocumentSchema.safeParse(value.document || value);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || 'Invalid board file.');
      replace(() => reset({ title: typeof value.title === 'string' ? value.title.slice(0, 100) : 'Imported board', document: parsed.data, view: fitted(parsed.data) }));
    } catch (e) { setError(errorMessage(e)); }
    if (importer.current) importer.current.value = '';
  }
  async function exportBoard(format: string) {
    const name = draft.title.trim().replace(/[^a-z0-9_-]/gi, '_') || 'whiteboard';
    if (format === 'json') { download(`${name}.json`, JSON.stringify({ format: 'algoworkbench-whiteboard', title: draft.title, document: board }, null, 2), 'application/json'); return; }
    const svg = serializeSvg(board, theme === 'dark' ? '#111923' : '#ffffff');
    if (format === 'svg') { download(`${name}.svg`, svg, 'image/svg+xml'); return; }
    let url = '';
    try {
      const bounds = sceneBounds(board.elements);
      const scale = Math.min(2, 4096 / bounds.width, 4096 / bounds.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(bounds.width * scale); canvas.height = Math.ceil(bounds.height * scale);
      const image = new Image(); url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render the board image. Try SVG export.')); image.src = url; });
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not export this board. Try SVG or JSON.');
      const fileUrl = URL.createObjectURL(blob), link = document.createElement('a'); link.href = fileUrl; link.download = `${name}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
    } catch (e) { setError(errorMessage(e)); } finally { if (url) URL.revokeObjectURL(url); }
  }

  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[role="dialog"]') || textEdit || boardsOpen || clearOpen || pendingReplace || deleteId) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); return; }
      if (target.closest('input,textarea,select,[contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); return; }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Space') { event.preventDefault(); setSpace(true); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); return; }
      if (event.key === 'Escape') { gesture.current = null; setPreview(null); setSelected(null); setTool('select'); return; }
      const next = tools.find(t => t.key.toLowerCase() === event.key.toLowerCase());
      if (next) { setTool(next.id); if (next.id !== 'select') setSelected(null); }
    };
    const keyup = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); };
    const blur = () => setSpace(false);
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur); };
  });

  const displayElements = board.elements.filter(e => !preview?.removed.has(e.id)).map(e => preview?.kind === 'move' && preview.element?.id === e.id ? preview.element : e);
  if (preview?.kind === 'draw' && preview.element) displayElements.push(preview.element);
  const selection = displayElements.find(e => e.id === selected);
  const selectionBounds = selection && elementBounds(selection);
  const currentColor = selectedElement?.color || color;
  return <div className="page-content whiteboard-page" hidden={!active}>
    <div className="page-heading"><div><div className="eyebrow"><span className="tiny-square" /> WORKSPACE</div></div><span className="tag">{board.elements.length} ELEMENTS</span></div>
    <div className="wb-document-bar">
      <input className="wb-title" aria-label="Board name" value={draft.title} maxLength={100} onChange={e => setDraft(current => ({ ...current, title: e.target.value }))} />
      <div className="actions"><button className="button secondary" onClick={() => replace(() => reset({ title: 'Untitled board', document: emptyDocument(), view: defaultView }))}><FilePlus2 size={15} /> New</button><button className="button secondary" onClick={() => void listBoards()}><FolderOpen size={15} /> My boards</button><button className="button primary" disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}{saving ? 'Saving…' : 'Save board'}</button></div>
    </div>
    <div className="panel wb-workspace">
      <div className="wb-toolbar" role="toolbar" aria-label="Drawing tools">
        <div className="wb-tool-group">{tools.map(item => <button key={item.id} className={`wb-tool ${tool === item.id ? 'selected' : ''}`} aria-label={item.label} aria-pressed={tool === item.id} title={`${item.label} (${item.key})`} onClick={() => { setTool(item.id); if (item.id !== 'select') setSelected(null); }}><item.icon size={18} /></button>)}</div>
        <div className="wb-tool-group"><button className="wb-tool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!past.length} onClick={undo}><Undo2 size={17} /></button><button className="wb-tool" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo}><Redo2 size={17} /></button></div>
        <select className="wb-preset" aria-label="Insert diagram" value="" onChange={e => { if (e.target.value) insertPreset(e.target.value as 'array' | 'tree' | 'graph'); }}><option value="" disabled>Insert diagram</option><option value="array">Array</option><option value="tree">Binary tree</option><option value="graph">Directed graph</option></select>
        <button className="wb-tool wb-clear" aria-label="Clear board" title="Clear board" disabled={!board.elements.length} onClick={() => setClearOpen(true)}><Trash2 size={17} /></button>
      </div>
      <div className="wb-properties">
        <div className="wb-colors" role="group" aria-label="Stroke color">{palette.map(value => <button key={value} aria-label={`Color ${value}`} aria-pressed={currentColor === value} className={`wb-swatch ${currentColor === value ? 'selected' : ''}`} style={{ backgroundColor: value }} onClick={() => { setColor(value); changeStyle({ color: value, ...(selectedElement?.fill !== 'none' && selectedElement ? { fill: value } : {}) }); }} />)}<label className="wb-custom-color" title="Custom color"><input type="color" aria-label="Custom color" value={currentColor} onChange={e => { setColor(e.target.value); changeStyle({ color: e.target.value }); }} /></label></div>
        <label>Width<select aria-label="Stroke width" value={selectedElement?.strokeWidth || strokeWidth} onChange={e => { setStrokeWidth(Number(e.target.value)); changeStyle({ strokeWidth: Number(e.target.value) }); }}>{[1, 2, 4, 6, 8, 12].map(value => <option value={value} key={value}>{value} px</option>)}</select></label>
        <label className="wb-checkbox"><input type="checkbox" checked={selectedElement ? selectedElement.fill !== 'none' : fill} onChange={e => { setFill(e.target.checked); changeStyle({ fill: e.target.checked ? currentColor : 'none' }); }} /> Fill</label>
        {(tool === 'text' || selectedElement?.type === 'text') && <label>Text size<select aria-label="Text size" value={selectedElement?.fontSize || fontSize} onChange={e => { setFontSize(Number(e.target.value)); changeStyle({ fontSize: Number(e.target.value) }); }}>{[14, 18, 24, 32, 48, 64].map(value => <option key={value}>{value}</option>)}</select></label>}
        {selectedElement && <div className="wb-selection-actions"><button className="wb-tool" aria-label="Duplicate selected" title="Duplicate (Ctrl+D)" onClick={duplicate}><Copy size={16} /></button><button className="wb-tool" aria-label="Delete selected" title="Delete selected" onClick={removeSelected}><Trash2 size={16} /></button>{selectedElement.type === 'text' && <button className="button subtle" onClick={() => setTextEdit({ position: selectedElement, value: selectedElement.text, element: selectedElement })}>Edit text</button>}</div>}
        <label className="wb-background">Background<select aria-label="Board background" value={board.background} onChange={e => commit({ ...board, background: e.target.value as BoardDocument['background'] })}><option value="dots">Dots</option><option value="grid">Grid</option><option value="plain">Plain</option></select></label>
        <label className="wb-checkbox"><input type="checkbox" checked={board.snap} onChange={e => commit({ ...board, snap: e.target.checked })} /><Grid2X2 size={14} /> Snap</label>
      </div>
      <div className="wb-canvas-wrap">
        <svg ref={surface} className={`wb-canvas tool-${space ? 'pan' : tool}`} role="application" aria-label="Whiteboard canvas" tabIndex={0} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { gesture.current = null; setPreview(null); }} onDoubleClick={event => { const hit = pickElement(board.elements, world(event), 7 / draft.view.zoom); if (hit?.type === 'text') { setSelected(hit.id); setTextEdit({ position: hit, value: hit.text, element: hit }); } }}>
          <defs><pattern id={gridId} width={GRID_SIZE * draft.view.zoom} height={GRID_SIZE * draft.view.zoom} patternUnits="userSpaceOnUse" x={draft.view.x} y={draft.view.y}>{board.background === 'dots' ? <circle cx={1} cy={1} r={1} fill="var(--wb-grid)" /> : <path d={`M ${GRID_SIZE * draft.view.zoom} 0 L 0 0 0 ${GRID_SIZE * draft.view.zoom}`} fill="none" stroke="var(--wb-grid)" strokeWidth={0.7} />}</pattern></defs>
          {board.background !== 'plain' && <rect width="100%" height="100%" fill={`url(#${gridId})`} pointerEvents="none" />}
          <g transform={`translate(${draft.view.x},${draft.view.y}) scale(${draft.view.zoom})`} pointerEvents="none">
            {displayElements.map(element => <g key={element.id} data-element-id={element.id} data-element-type={element.type}><ElementView element={element} /></g>)}
            {selectionBounds && <rect className="wb-selection" x={selectionBounds.x - 6 / draft.view.zoom} y={selectionBounds.y - 6 / draft.view.zoom} width={selectionBounds.width + 12 / draft.view.zoom} height={selectionBounds.height + 12 / draft.view.zoom} fill="none" strokeWidth={1.5 / draft.view.zoom} strokeDasharray={`${5 / draft.view.zoom} ${4 / draft.view.zoom}`} />}
          </g>
        </svg>
        {!board.elements.length && !preview && <div className="wb-empty"><Pencil size={24} /><strong>Start drawing</strong><span>Choose a tool or insert an array, tree, or graph.</span></div>}
        <div className="wb-zoom"><button className="wb-tool" aria-label="Zoom out" onClick={() => zoom(1 / 1.2)}><ZoomOut size={17} /></button><span>{Math.round(draft.view.zoom * 100)}%</span><button className="wb-tool" aria-label="Zoom in" onClick={() => zoom(1.2)}><ZoomIn size={17} /></button><button className="wb-tool" aria-label="Fit board" title="Fit all elements" onClick={fit}><Scan size={17} /></button></div>
      </div>
      <div className="wb-footer"><span>{saving ? 'Saving to account…' : draft.id && !modified ? <><Check size={13} /> Saved to account</> : localStatus}</span><span>Space + drag to pan · Ctrl + scroll to zoom · Shift for constrained shapes</span></div>
    </div>
    <div className="wb-file-actions"><div className="actions"><button className="button secondary" onClick={() => importer.current?.click()}><Upload size={15} /> Import JSON</button><select aria-label="Export board" value="" onChange={e => { if (e.target.value) void exportBoard(e.target.value); }}><option value="" disabled>Export board</option><option value="png">PNG image</option><option value="svg">SVG image</option><option value="json">Editable JSON</option></select><Download size={15} className="muted" /></div><span className="muted small-text">Local drafts save automatically. Account saves are private.</span><input ref={importer} aria-label="Import whiteboard file" type="file" accept=".json,application/json" hidden onChange={e => void importBoard(e.target.files?.[0])} /></div>
    {!boardsOpen && <ErrorBox message={error} />}
    {textEdit && <Modal title={textEdit.element ? 'Edit text' : 'Add text'} onClose={() => setTextEdit(null)}><form className="form-stack" onSubmit={e => { e.preventDefault(); submitText(); }}><label>Text<textarea aria-label="Board text" rows={5} maxLength={2000} required value={textEdit.value} onChange={e => setTextEdit({ ...textEdit, value: e.target.value })} placeholder="Label a node, write a formula, or add a note" /></label><button className="button primary full" disabled={!textEdit.value.trim()}>{textEdit.element ? 'Update text' : 'Add text'}</button></form></Modal>}
    {clearOpen && <Modal title="Clear the board?" onClose={() => setClearOpen(false)}><p className="muted">Remove all elements from this board. You can undo this change.</p><div className="actions modal-actions"><button className="button secondary" onClick={() => setClearOpen(false)}>Cancel</button><button className="button danger" onClick={() => { commit({ ...board, elements: [] }); setSelected(null); setClearOpen(false); }}>Clear board</button></div></Modal>}
    {pendingReplace && <Modal title="Replace the current board?" onClose={() => setPendingReplace(null)}><p className="muted">This board has changes that have not been saved to your account. Save it or export JSON first if you need a copy.</p><div className="actions modal-actions"><button className="button secondary" onClick={() => setPendingReplace(null)}>Keep editing</button><button className="button primary" onClick={() => { pendingReplace(); setPendingReplace(null); }}>Replace board</button></div></Modal>}
    {boardsOpen && !deleteId && <Modal title="My whiteboards" wide onClose={() => setBoardsOpen(false)}><ErrorBox message={error} />{loading ? <div className="empty-library"><LoaderCircle className="spin" /></div> : !boards.length ? <div className="empty-library"><FolderOpen size={28} /><h3>No saved whiteboards</h3><p>Save a board to your account to open it on another device.</p></div> : <div className="wb-saved-list">{boards.map(item => <div className="saved-row" key={item.id}><button className="saved-title" onClick={() => void openBoard(item.id)}><strong>{item.title}</strong><span>{new Date(item.updated_at).toLocaleString()}</span></button><button className="button subtle" onClick={() => void openBoard(item.id)}>Open</button><button className="icon-button danger-hover" aria-label={`Delete ${item.title}`} onClick={() => setDeleteId(item.id)}><Trash2 size={16} /></button></div>)}</div>}</Modal>}
    {deleteId && <Modal title="Delete this saved board?" onClose={() => setDeleteId(null)}><p className="muted">This permanently removes the saved board from your account.</p><ErrorBox message={error} /><div className="actions modal-actions"><button className="button secondary" onClick={() => setDeleteId(null)}>Cancel</button><button className="button danger" disabled={loading} onClick={() => void deleteBoard()}>{loading ? 'Deleting…' : 'Delete board'}</button></div></Modal>}
  </div>;
}
