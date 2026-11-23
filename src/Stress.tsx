import { useEffect, useRef, useState } from 'react';
import { FlaskConical, Play, Square, LoaderCircle, Check, Shuffle, Download, Save, FileCode2, AlertTriangle, ChevronDown } from 'lucide-react';
import { Editor, LanguageSelect, ErrorBox, CopyButton } from './components';
import { api, ApiError, download, errorMessage, initialStress, starters, useDraft } from './lib';
import type { AppContext, StressConfig, StressJob, StressStep } from './types';

export function Stress({ ctx, restored, onRestored, active }: { ctx: AppContext; restored: { config: StressConfig; result: StressJob } | null; onRestored: () => void; active: boolean }) {
  const [config, setConfig] = useDraft<StressConfig>(`awb-stress-${ctx.owner}`, initialStress);
  const [run, setRun] = useDraft<{ job: StressJob | null; config: StressConfig; saved: boolean; mode: 'stepped' | 'background' }>(`awb-stress-result-${ctx.owner}`, { job: null, config: initialStress, saved: false, mode: ctx.config.stressMode || 'background' });
  const job = run.job;
  const setJob = (next: StressJob | null) => setRun(previous => ({ ...previous, job: next }));
  const [starting, setStarting] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); const [generatorOpen, setGeneratorOpen] = useState(false);
  const mounted = useRef(true);
  const caseAbort = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (restored && job?.status !== 'running') { setConfig(restored.config); setRun({ job: restored.result, config: restored.config, saved: true, mode: ctx.config.stressMode || 'background' }); onRestored(); } }, [restored, job?.status, onRestored, setConfig, setRun]);
  useEffect(() => {
    if (!job || job.status !== 'running' || run.mode === 'stepped') return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<StressJob>(ctx, `/stress/${job.id}`);
        if (!stopped) { setJob(next); setError(null); if (next.status === 'running') timer = setTimeout(() => void poll(), 1200); }
      } catch (e) {
        if (!stopped) {
          setError(errorMessage(e));
          if (e instanceof ApiError && [401, 404].includes(e.status)) setJob({ ...job, status: 'error', finishedAt: Date.now(), error: errorMessage(e) });
          else timer = setTimeout(() => void poll(), 5000);
        }
      }
    };
    timer = setTimeout(() => void poll(), 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [job?.id, job?.status, run.mode]);
  useEffect(() => {
    if (!job || job.status !== 'running' || run.mode !== 'stepped') return;
    let stopped = false;
    const controller = new AbortController();
    caseAbort.current = controller;
    const step = async () => {
      const remaining = 10 * 60 * 1000 - (Date.now() - job.startedAt);
      if (remaining <= 0) { setJob({ ...job, status: 'error', finishedAt: Date.now(), error: 'The stress test exceeded its 10-minute limit.' }); return; }
      try {
        const next = await api<StressStep>(ctx, '/stress/step', {
          method: 'POST', body: JSON.stringify({ config: run.config, iteration: job.completed + 1 }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(remaining)]),
        });
        if (stopped || controller.signal.aborted) return;
        const completed = job.completed + (next.log ? 1 : 0);
        const status = next.status === 'passed' && completed < job.total ? 'running' : next.status;
        setRun(previous => {
          if (previous.job?.id !== job.id || previous.job.status !== 'running') return previous;
          return { ...previous, job: { ...previous.job, completed, status, logs: next.log ? [...previous.job.logs, next.log] : previous.job.logs, counterexample: next.counterexample, error: next.error, ...(status === 'running' ? {} : { finishedAt: Date.now() }) } };
        });
        setError(null);
      } catch (e) {
        if (stopped || controller.signal.aborted) return;
        setJob({ ...job, status: 'error', finishedAt: Date.now(), error: errorMessage(e) });
      }
    };
    const timer = setTimeout(() => void step(), 100);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [job?.id, job?.status, job?.completed, run.mode]);
  async function start() {
    if (!ctx.requireAuth()) return;
    setStarting(true); setError(null); setJob(null);
    try {
      const mode = ctx.config.stressMode || 'background';
      const next: StressJob = mode === 'stepped' ? { id: crypto.randomUUID(), status: 'running', completed: 0, total: config.iterations, seed: config.seed, startedAt: Date.now(), logs: [], counterexample: null, error: null } : await api<StressJob>(ctx, '/stress', { method: 'POST', body: JSON.stringify(config) });
      if (mounted.current) setRun({ job: next, config, saved: false, mode });
    }
    catch (e) { setError(errorMessage(e)); } finally { setStarting(false); }
  }
  async function cancel() {
    if (!job) return;
    if (run.mode === 'stepped') { caseAbort.current?.abort(); setJob({ ...job, status: 'cancelled', finishedAt: Date.now(), error: null }); return; }
    try { setJob(await api<StressJob>(ctx, `/stress/${job.id}`, { method: 'DELETE' })); } catch (e) { setError(errorMessage(e)); }
  }
  async function save() {
    if (!job) return; setSaving(true); setError(null);
    try { await api(ctx, '/stress/save', { method: 'POST', body: JSON.stringify({ config: run.config, result: job }) }); setRun(previous => ({ ...previous, saved: true })); ctx.notify('Stress test saved to your account history.'); }
    catch (e) { setError(errorMessage(e)); } finally { setSaving(false); }
  }
  const running = starting || job?.status === 'running';
  const statusLabel = !job ? 'Waiting for your first experiment' : ({ running: 'Hunting for edge cases…', passed: 'All tests passed. Nicely done.', mismatch: 'Found it. A counterexample!', error: 'A program needs your attention.', cancelled: 'Test stopped.' })[job.status];
  function numberField(label: string, key: 'minSize' | 'maxSize' | 'minValue' | 'maxValue', min: number, max: number) {
    return <label>{label}<input type="number" value={config.generator[key]} min={min} max={max} required onChange={e => setConfig({ ...config, generator: { ...config.generator, [key]: e.target.valueAsNumber } })} /></label>;
  }
  return <div className="page-content" hidden={!active}>
    <div className="page-heading"><div><div className="eyebrow"><span className="tiny-square" /> STRESS LAB</div><h1>Break it before the judge does<span className="accent">.</span></h1><p>Two solutions. Random test cases. Zero room for lucky guesses.</p></div><span className="tag purple">EDGE CASE HUNTER</span></div>
    <form onSubmit={e => { e.preventDefault(); void start(); }}>
      <div className="stress-programs">{(['brute', 'optimized'] as const).map((role, i) => <section className="panel" key={role}><div className="panel-header"><h2><FileCode2 size={16} className={i ? 'accent' : 'purple-text'} /> {role === 'brute' ? 'Brute-force solution' : 'Optimized solution'}</h2><LanguageSelect value={config[role].language} label={`${role} language`} onChange={language => setConfig({ ...config, [role]: { language, code: config[role].code === starters[config[role].language] ? starters[language] : config[role].code } })} /></div><div className="panel-description">{i ? 'The fast one. Let’s see if it holds up.' : 'Your trusted, correct reference solution.'}</div><Editor label={`${role} source code`} height="300px" code={config[role].code} language={config[role].language} onChange={code => setConfig({ ...config, [role]: { ...config[role], code } })} /></section>)}</div>
      <section className="panel generator-panel"><div className="panel-header"><h2><Shuffle size={16} /> Test case generator</h2><span className="micro-label">REPRODUCIBLE BY SEED</span></div><div className="generator-settings"><label>Generator<select value={config.generator.type} onChange={e => setConfig({ ...config, generator: { ...config.generator, type: e.target.value as StressConfig['generator']['type'] } })}><option value="array">Integer array</option><option value="pairs">Integer pair</option><option value="custom">Custom program</option></select></label>{config.generator.type === 'array' && <>{numberField('Min. array size', 'minSize', 1, 1000)}{numberField('Max. array size', 'maxSize', 1, 1000)}</>}{config.generator.type !== 'custom' && <>{numberField('Min. value', 'minValue', -1000000000, 1000000000)}{numberField('Max. value', 'maxValue', -1000000000, 1000000000)}</>}</div>
        <div className="generator-format"><span className="micro-label">INPUT FORMAT</span><code>{config.generator.type === 'array' ? 'n\na₁ a₂ … aₙ' : config.generator.type === 'pairs' ? 'a b' : 'Your generator’s stdout becomes the test input.'}</code></div>
        {config.generator.type === 'custom' && <div className="custom-generator"><div className="panel-header"><button type="button" className="text-button" onClick={() => setGeneratorOpen(!generatorOpen)}><ChevronDown size={15} /> {generatorOpen ? 'Hide' : 'Edit'} generator code</button><LanguageSelect label="Generator language" value={config.generator.program?.language || 'python'} onChange={language => setConfig({ ...config, generator: { ...config.generator, program: { language, code: starters[language] } } })} /></div><p className="panel-description">Read <code>seed iteration</code> from stdin and print one test case to stdout. Iterations start at 1.</p>{generatorOpen && <Editor height="220px" label="Generator source code" code={config.generator.program?.code || ''} language={config.generator.program?.language || 'python'} onChange={code => setConfig({ ...config, generator: { ...config.generator, program: { language: config.generator.program?.language || 'python', code } } })} />}</div>}
      </section>
      <div className="stress-options"><label>Test cases<input type="number" value={config.iterations} min={1} max={50} required onChange={e => setConfig({ ...config, iterations: e.target.valueAsNumber })} /><span className="field-help">Up to 50 per run</span></label><label>Random seed<div className="seed-input"><input type="number" value={config.seed} min={0} max={4294967295} required onChange={e => setConfig({ ...config, seed: e.target.valueAsNumber })} /><button className="icon-button" type="button" aria-label="Randomize seed" onClick={() => setConfig({ ...config, seed: crypto.getRandomValues(new Uint32Array(1))[0] })}><Shuffle size={15} /></button></div><span className="field-help">Same seed, same built-in cases</span></label><label>Compare outputs<select value={config.comparison} onChange={e => setConfig({ ...config, comparison: e.target.value as 'tokens' | 'exact' })}><option value="tokens">Ignore whitespace</option><option value="exact">Exact match</option></select><span className="field-help">Exact mode normalizes CRLF</span></label><label>Time limit (seconds)<input type="number" value={config.timeLimit} min={1} max={10} step={1} required onChange={e => setConfig({ ...config, timeLimit: e.target.valueAsNumber })} /><span className="field-help">Per program, per test case</span></label></div>
      <div className="run-bar"><span className="muted small-text">{ctx.config.stressMode === 'stepped' ? 'Keep this tab open while testing. Progress is saved in this browser.' : 'Each case runs both solutions in isolated sandboxes.'}</span><div className="actions">{job?.status === 'running' && <button type="button" className="button secondary" onClick={() => void cancel()}><Square size={13} /> Stop test</button>}<button type="submit" disabled={running} className="button primary">{running ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}{running ? 'Testing…' : 'Start stress test'}</button></div></div>
    </form>
    <ErrorBox message={error || job?.error || null} />
    <section className="panel stress-results"><div className="panel-header"><h2><FlaskConical size={16} /> Test results</h2>{job && <span className="micro-label">SEED {job.seed}</span>}</div><div className={`stress-result-summary ${job?.status || ''}`}>{job?.status === 'running' ? <LoaderCircle className="spin" /> : job?.status === 'passed' ? <Check /> : job?.status === 'mismatch' || job?.status === 'error' ? <AlertTriangle /> : <FlaskConical />}<div><h3>{statusLabel}</h3><p>{job ? `${job.completed} of ${job.total} cases completed${job.finishedAt ? ` · ${((job.finishedAt - job.startedAt) / 1000).toFixed(1)}s elapsed` : ''}` : 'The first mismatch will stop the run and appear here.'}</p></div>{job && job.status !== 'running' && <div className="actions result-actions"><button className="button subtle" onClick={() => download(`stress-${job.seed}.json`, JSON.stringify({ config: run.config, result: job }, null, 2), 'application/json')}><Download size={15} /> Export</button><button className="button secondary" disabled={saving || run.saved} onClick={() => void save()}><Save size={15} />{saving ? 'Saving…' : run.saved ? 'Saved' : 'Save run'}</button></div>}</div>
      {job && <div className="progress-track"><div style={{ width: `${job.completed / job.total * 100}%` }} /></div>}
      {job?.counterexample && <div className="counterexample"><div className="counterexample-title"><span className="tag warning">CASE #{job.counterexample.iteration}</span><strong>{job.counterexample.role ? `${job.counterexample.role} program failed` : 'Outputs do not match'}</strong><button className="button subtle" onClick={() => download(`counterexample-${job.seed}.txt`, job.counterexample!.input)}><Download size={14} /> Download input</button></div><div className="counterexample-grid">{([{ name: 'Failing input', value: job.counterexample.input }, ...(job.counterexample.generator ? [{ name: 'Generator error', value: job.counterexample.generator.error || job.counterexample.generator.output }] : [{ name: 'Brute-force output', value: (job.counterexample.brute?.output || '') + (job.counterexample.brute?.error ? `\n[stderr]\n${job.counterexample.brute.error}` : '') }, { name: 'Optimized output', value: (job.counterexample.optimized?.output || '') + (job.counterexample.optimized?.error ? `\n[stderr]\n${job.counterexample.optimized.error}` : '') }])]).map(item => <div className="counterexample-cell" key={item.name}><div><span>{item.name}</span><CopyButton value={item.value} /></div><pre>{item.value || '(No output)'}</pre></div>)}</div></div>}
      {!!job?.logs.length && <div className="test-log"><div className="test-log-header"><span>TEST CASE</span><span>BRUTE FORCE</span><span>OPTIMIZED</span><span>RESULT</span></div>{job.logs.map(log => <div className="test-log-row" key={log.iteration}><span>#{String(log.iteration).padStart(2, '0')}</span><span>{Math.round(log.bruteTime * 1000)} ms</span><span>{Math.round(log.optimizedTime * 1000)} ms</span><span className={log.matches ? 'accent' : 'danger-text'}>{log.matches ? 'PASS' : 'FAIL'}</span></div>)}</div>}
    </section>
  </div>;
}
