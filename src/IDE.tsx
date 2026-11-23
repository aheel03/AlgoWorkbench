import { useEffect, useRef, useState } from 'react';
import { Play, Save, Download, RotateCcw, Terminal, CornerDownLeft, LoaderCircle, FileCode2, Check, Clock3, Cpu, Square } from 'lucide-react';
import { Editor, LanguageSelect, CopyButton, Modal, ErrorBox, Dino } from './components';
import { api, download, errorMessage, extensions, starters } from './lib';
import type { AppContext, RunResult, Solution } from './types';

export function IDE({ ctx, solution, setSolution, onSaved, active }: { ctx: AppContext; solution: Solution; setSolution: (s: Solution) => void; onSaved: () => void; active: boolean }) {
  const [result, setResult] = useState<RunResult | null>(null); const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); const [saveModal, setSaveModal] = useState(false); const [resetModal, setResetModal] = useState(false);
  const [title, setTitle] = useState(solution.title); const [saving, setSaving] = useState(false); const [outputTab, setOutputTab] = useState<'output' | 'errors'>('output');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  async function run() {
    if (busy || !ctx.requireAuth()) return;
    if (!solution.code.trim()) { setError('Write some code first.'); return; }
    setBusy(true); setError(null); setResult(null); abort.current = new AbortController();
    try { const data = await api<RunResult>(ctx, '/run', { method: 'POST', body: JSON.stringify(solution), signal: abort.current.signal }); setResult(data); setOutputTab(data.status !== 'success' || data.exitCode !== 0 ? 'errors' : 'output'); }
    catch (e) { if (!abort.current?.signal.aborted) setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  function showSave() { if (!ctx.requireAuth()) return; setTitle(solution.title); setError(null); setSaveModal(true); }
  async function save() {
    setSaving(true); setError(null);
    try { const saved = await api<Solution>(ctx, '/solutions', { method: 'POST', body: JSON.stringify({ ...solution, title }) }); setSolution(saved); onSaved(); setSaveModal(false); ctx.notify('Solution saved to your account.'); }
    catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!active || !(e.ctrlKey || e.metaKey) || saveModal || resetModal) return;
      if (e.key === 'Enter') { e.preventDefault(); void run(); }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); showSave(); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  const failed = result && (result.status !== 'success' || result.exitCode !== 0);
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="tiny-square" /> ONLINE IDE</div><h1>Your next accepted solution<span className="accent">.</span></h1><p>A clear head, a blank file, and a problem worth solving.</p></div><span className="tag"><span className="status-dot" /> WORKSPACE READY</span></div>
    <div className="workspace-toolbar"><div className="toolbar-label"><Terminal size={18} /><span>Code playground</span><span className="muted slash">/</span><span className="muted">{solution.title}.{extensions[solution.language]}</span></div><div className="actions"><button className="button subtle" onClick={() => download(`${solution.title}.${extensions[solution.language]}`, solution.code)}><Download size={15} /><span>Export</span></button><button className="button secondary" onClick={showSave}><Save size={15} /> Save solution</button></div></div>
    <div className="ide-grid">
      <section className="panel code-panel"><div className="panel-header"><div className="file-tab"><FileCode2 size={15} className="accent" /> main.{extensions[solution.language]}<span className="file-dot" title="Draft saved locally" /></div><div className="panel-controls"><LanguageSelect value={solution.language} onChange={language => { setSolution({ ...solution, id: undefined, language, code: solution.code === starters[solution.language] ? starters[language] : solution.code }); setResult(null); }} /><button className="icon-button" aria-label="Reset code" onClick={() => setResetModal(true)}><RotateCcw size={15} /></button></div></div>
        <Editor code={solution.code} language={solution.language} onChange={code => setSolution({ ...solution, code })} />
        <div className="editor-footer"><span>UTF-8 <span className="muted">·</span> {solution.code.split('\n').length} lines</span><span className="draft-label"><Check size={12} /> Draft autosaved locally</span></div>
      </section>
      <div className="io-column">
        <section className="panel input-panel"><div className="panel-header"><h2><CornerDownLeft size={16} /> Custom input</h2><span className="micro-label">STDIN</span></div><textarea aria-label="Custom input" value={solution.input} onChange={e => setSolution({ ...solution, input: e.target.value })} placeholder="Enter your test case here…" spellCheck={false} /><div className="input-footnote">Input is passed to your program as standard input.</div></section>
        <section className="panel output-panel"><div className="panel-header"><div className="output-tabs"><button className={outputTab === 'output' ? 'active' : ''} onClick={() => setOutputTab('output')}>Output</button><button className={outputTab === 'errors' ? 'active' : ''} onClick={() => setOutputTab('errors')}>Errors{result?.error && <span className="error-indicator" />}</button></div><CopyButton value={outputTab === 'output' ? result?.output || '' : result?.error || ''} /></div>
          <div className="output-body" aria-live="polite">{busy ? <div className="empty-output"><LoaderCircle className="spin" size={25} /><strong>Running your code…</strong><span>A fresh sandbox, just for this run.</span></div> : result ? <><div className={`execution-status ${failed ? 'failure' : 'success'}`}>{failed ? `Execution failed · exit ${result.exitCode}` : 'Process finished successfully'}</div><pre>{outputTab === 'output' ? result.output || '(No standard output)' : result.error || '(No errors)'}</pre>{result.truncated && <div className="error-box">Output was truncated by the compiler.</div>}</> : <div className="empty-output"><Terminal size={27} /><strong>Ready when you are.</strong><span>Run your code to see the magic happen.</span></div>}</div>
          <div className="result-metrics"><span><Clock3 size={13} /> {result ? `${Math.round(result.time * 1000)} ms` : '— ms'}</span><span><Cpu size={13} /> {result ? `${(result.memory / 1024).toFixed(1)} MB` : '— MB'}</span></div>
        </section>
      </div>
    </div>
    {!saveModal && <ErrorBox message={error} />}
    <div className="run-bar"><div className="shortcut"><kbd>Ctrl</kbd><span>+</span><kbd>Enter</kbd><span>to run your code</span></div><div className="actions">{busy && <button className="button secondary" onClick={() => abort.current?.abort()}><Square size={13} /> Stop</button>}<button className="button primary run-button" disabled={busy} onClick={() => void run()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Play size={15} fill="currentColor" />}{busy ? 'Running…' : 'Run code'}</button></div></div>
    <div className="tip-banner"><Dino /><div><div className="eyebrow">A LITTLE LESS GUESSWORK.</div><h3>Works on the sample? Put it to the test.</h3><p>Find the edge case before the judge does. Meet your new stress-testing sidekick.</p></div><span className="pixel-decoration" aria-hidden="true">+ +<br />+ +</span></div>
    {saveModal && <Modal title="Save your solution" onClose={() => setSaveModal(false)}><form className="form-stack" onSubmit={e => { e.preventDefault(); void save(); }}><p className="muted">Keep this solution in your account and pick up where you left off, on any device.</p><label>Solution name<input value={title} onChange={e => setTitle(e.target.value)} maxLength={100} required /></label><ErrorBox message={error} /><button className="button primary full" disabled={saving}>{saving ? 'Saving…' : 'Save solution'}</button></form></Modal>}
    {resetModal && <Modal title="Reset this file?" onClose={() => setResetModal(false)}><p className="muted">This replaces the current code with the starter for {solution.language}. Save or export your work first if you need it.</p><div className="actions modal-actions"><button className="button secondary" onClick={() => setResetModal(false)}>Keep editing</button><button className="button primary" onClick={() => { setSolution({ ...solution, id: undefined, code: starters[solution.language] }); setResult(null); setResetModal(false); }}>Reset file</button></div></Modal>}
  </div>;
}
