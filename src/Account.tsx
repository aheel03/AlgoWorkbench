import { useEffect, useState } from 'react';
import { FileCode2, FolderOpen, Trash2, LogOut, UserRound, ShieldCheck, LoaderCircle, FlaskConical, RefreshCw } from 'lucide-react';
import { api, errorMessage, languageNames } from './lib';
import { ErrorBox, Modal } from './components';
import type { AppContext, HistoryItem, Solution, SolutionItem, StressConfig, StressJob } from './types';

export function Library({ ctx, refresh, onOpen, onHistory }: { ctx: AppContext; refresh: number; onOpen: (s: Solution) => void; onHistory: (r: { config: StressConfig; result: StressJob }) => void }) {
  const [solutions, setSolutions] = useState<SolutionItem[]>([]); const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [pendingDelete, setPendingDelete] = useState<string | null>(null); const [working, setWorking] = useState(false);
  async function load() {
    if (!ctx.session) return; setLoading(true); setError(null);
    const results = await Promise.allSettled([api<SolutionItem[]>(ctx, '/solutions'), api<HistoryItem[]>(ctx, '/history')]);
    if (results[0].status === 'fulfilled') setSolutions(results[0].value);
    if (results[1].status === 'fulfilled') setHistory(results[1].value);
    const rejected = results.find(r => r.status === 'rejected'); if (rejected?.status === 'rejected') setError(errorMessage(rejected.reason));
    setLoading(false);
  }
  useEffect(() => { void load(); }, [refresh, ctx.session?.user.id]);
  async function open(id: string, isHistory = false) {
    setWorking(true); setError(null);
    try { if (isHistory) onHistory(await api(ctx, `/history/${id}`)); else onOpen(await api(ctx, `/solutions/${id}`)); }
    catch (e) { setError(errorMessage(e)); } finally { setWorking(false); }
  }
  async function remove() {
    setWorking(true);
    try { await api(ctx, `/solutions/${pendingDelete}`, { method: 'DELETE' }); setPendingDelete(null); await load(); ctx.notify('Solution deleted.'); }
    catch (e) { setError(errorMessage(e)); } finally { setWorking(false); }
  }
  return <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><span className="tiny-square" /> YOUR COLLECTION</div><h1>Good code is worth keeping<span className="accent">.</span></h1><p>Your saved solutions and stress-testing discoveries, all in one place.</p></div><button className="button secondary" onClick={() => void load()} disabled={loading || !ctx.session}><RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh</button></div><ErrorBox message={error} />
    {!ctx.session ? <div className="panel empty-library"><FolderOpen size={38} /><h2>Make yourself at home.</h2><p>Create an account to save solutions and experiments across devices.</p><button className="button primary" onClick={ctx.requireAuth}>Create your account</button></div> : <>
      <section className="panel"><div className="panel-header"><h2><FolderOpen size={17} /> Saved solutions</h2><span className="count-tag">{solutions.length}</span></div>{loading ? <div className="empty-library"><LoaderCircle className="spin" /></div> : solutions.length ? <div className="saved-list">{solutions.map(s => <div className="saved-row" key={s.id}><div className="saved-file-icon"><FileCode2 size={20} /></div><button className="saved-title" disabled={working} onClick={() => void open(s.id!)}><strong>{s.title}</strong><span>{languageNames[s.language]} · {s.updated_at && new Date(s.updated_at).toLocaleDateString()}</span></button><button className="button subtle" disabled={working} onClick={() => void open(s.id!)}>Open in IDE</button><button className="icon-button danger-hover" aria-label={`Delete ${s.title}`} onClick={() => setPendingDelete(s.id!)}><Trash2 size={16} /></button></div>)}</div> : <div className="empty-library"><FileCode2 size={32} /><h3>A fresh shelf.</h3><p>Save a solution from the IDE and it will appear here.</p></div>}</section>
      <section className="panel history-panel"><div className="panel-header"><h2><FlaskConical size={17} /> Saved stress tests</h2><span className="count-tag">{history.length}</span></div>{history.length ? history.map(h => <div className="saved-row" key={h.id}><FlaskConical size={20} className="purple-text" /><button className="saved-title" disabled={working} onClick={() => void open(h.id, true)}><strong>Seed {h.result.seed} · {h.result.completed}/{h.result.total} cases</strong><span>{new Date(h.created_at).toLocaleString()}</span></button><span className={`tag ${h.result.status === 'passed' ? '' : 'warning'}`}>{h.result.status.toUpperCase()}</span></div>) : <div className="empty-library"><p>Save a completed run in the Stress Lab to keep its configuration and results.</p></div>}</section>
    </>}
    {pendingDelete && <Modal title="Delete this solution?" onClose={() => setPendingDelete(null)}><p className="muted">This permanently removes the solution from your account.</p><div className="actions modal-actions"><button className="button secondary" onClick={() => setPendingDelete(null)}>Keep solution</button><button className="button danger" disabled={working} onClick={() => void remove()}>{working ? 'Deleting…' : 'Delete solution'}</button></div></Modal>}
  </div>;
}

export function Account({ ctx }: { ctx: AppContext }) {
  const [username, setUsername] = useState(ctx.session?.user.user_metadata.username || ''); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (ctx.session) void api<{ username: string } | null>(ctx, '/profile').then(p => { if (p) setUsername(p.username); }).catch(e => setError(errorMessage(e))); }, [ctx.session?.user.id]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api(ctx, '/profile', { method: 'PATCH', body: JSON.stringify({ username }) }); const { error } = await ctx.client!.auth.updateUser({ data: { username } }); if (error) throw error; ctx.notify('Profile updated.'); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><span className="tiny-square" /> PLAYER PROFILE</div><h1>Your corner of the workbench<span className="accent">.</span></h1><p>A familiar handle. A place to keep making progress.</p></div></div>{ctx.session ? <section className="panel account-panel"><div className="panel-header"><h2><UserRound size={17} /> Account details</h2><span className="tag"><ShieldCheck size={13} /> VERIFIED SESSION</span></div><form className="form-stack account-form" onSubmit={e => void save(e)}><div className="large-avatar">{String(username || ctx.session.user.email || '?').slice(0, 2).toUpperCase()}</div><label>Username<input value={username} minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" required onChange={e => setUsername(e.target.value)} /></label><label>Email address<input value={ctx.session.user.email || ''} readOnly className="readonly" /></label><p className="muted small-text">Member since {new Date(ctx.session.user.created_at).toLocaleDateString()}. Your password and sessions are managed securely by Supabase.</p><ErrorBox message={error} /><div className="actions"><button className="button primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button><button type="button" className="button secondary" onClick={async () => { const { error } = await ctx.client!.auth.signOut(); if (error) setError(error.message); else ctx.notify('Signed out. See you next time.'); }}><LogOut size={15} /> Sign out</button></div></form></section> : <div className="panel empty-library"><UserRound size={38} /><h2>Every programmer starts somewhere.</h2><p>Create an account to make this workspace yours.</p><button className="button primary" onClick={ctx.requireAuth}>Create account</button></div>}</div>;
}
