import { useCallback, useEffect, useState } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { Terminal, FlaskConical, FolderOpen, UserRound, ChevronRight, PanelLeftClose, PanelLeftOpen, BookOpen, X, Check, Sun, Moon, PanelsTopLeft, ExternalLink } from 'lucide-react';
import { Auth } from './Auth';
import { IDE } from './IDE';
import { Stress } from './Stress';
import { Account, Library } from './Account';
import { Modal } from './components';
import { Whiteboard } from './Whiteboard';
import { useTheme } from './theme';
import { initialSolution, useDraft } from './lib';
import type { AppConfig, AppContext, Solution, StressConfig, StressJob } from './types';

type Page = 'ide' | 'stress' | 'whiteboard' | 'library' | 'account';
const nav = [{ id: 'ide', label: 'Online IDE', icon: Terminal, shortcut: '01' }, { id: 'stress', label: 'Stress Lab', icon: FlaskConical, shortcut: '02' }, { id: 'whiteboard', label: 'Whiteboard', icon: PanelsTopLeft, shortcut: '03' }, { id: 'library', label: 'My solutions', icon: FolderOpen, shortcut: '04' }] as const;

function Workbench({ ctx }: { ctx: AppContext }) {
  const { theme, toggleTheme } = useTheme();
  const [page, setPage] = useState<Page>('ide'); const [collapsed, setCollapsed] = useState(false); const [help, setHelp] = useState(false);
  const [solution, setSolution] = useDraft<Solution>(`awb-ide-${ctx.owner}`, initialSolution); const [refresh, setRefresh] = useState(0);
  const [restored, setRestored] = useState<{ config: StressConfig; result: StressJob } | null>(null);
  const clearRestored = useCallback(() => setRestored(null), []);
  const name = ctx.session?.user.user_metadata.username || ctx.session?.user.email?.split('@')[0] || 'Guest programmer';
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar"><a className="brand" href="#ide" onClick={e => { e.preventDefault(); setPage('ide'); }} aria-label="AlgoWorkbench home"><span className="brand-mark"><span /> <i /></span><div>algo<span>workbench<span className="brand-period">_</span></span></div></a>
      <div className="workspace-name"><span className="workspace-avatar">W</span><div><strong>Personal workspace</strong><span>Code, test, and diagram</span></div><ChevronRight size={15} /></div>
      <div className="nav-heading">THE WORKBENCH</div><nav aria-label="Main navigation">{nav.map(item => <button key={item.id} onClick={() => setPage(item.id)} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined}><item.icon size={19} /><span>{item.label}</span><span className="nav-shortcut">{item.shortcut}</span></button>)}</nav>
      <div className="sidebar-shortcuts"><div className="nav-heading">SHORTCUTS</div><p><kbd>Ctrl</kbd> + <kbd>Enter</kbd><span>Run code</span></p><p><kbd>Ctrl</kbd> + <kbd>S</kbd><span>Save work</span></p></div>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'account' ? 'active' : ''}`} onClick={() => setPage('account')}><UserRound size={18} /><span>My account</span></button><button className="nav-item" onClick={() => setHelp(true)}><BookOpen size={18} /><span>Quick start guide</span><ExternalLink size={13} className="muted" /></button><div className="sidebar-version"><span className="status-dot" /> WORKSPACE<span>v1.0</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumbs"><button className="icon-button sidebar-toggle" aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button><span>Workspace</span><ChevronRight size={13} /><strong>{page === 'account' ? 'My account' : nav.find(n => n.id === page)?.label}</strong></div><div className="topbar-right"><button className="button secondary theme-toggle" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={theme === 'light'} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}<span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span></button>{ctx.session ? <button className="profile-button" onClick={() => setPage('account')}><span className="avatar">{name.slice(0, 2).toUpperCase()}</span><span>{name}</span></button> : <button className="button top-signin" onClick={ctx.requireAuth}><UserRound size={15} /> Sign in <span className="muted">/</span> Sign up</button>}</div></header>
      <main><div hidden={page !== 'ide'}><IDE ctx={ctx} active={page === 'ide'} solution={solution} setSolution={setSolution} onSaved={() => setRefresh(r => r + 1)} /></div><Stress ctx={ctx} active={page === 'stress'} restored={restored} onRestored={clearRestored} /><Whiteboard ctx={ctx} active={page === 'whiteboard'} />{page === 'library' && <Library ctx={ctx} refresh={refresh} onOpen={s => { setSolution(s); setPage('ide'); ctx.notify('Solution opened.'); }} onHistory={r => { setRestored(r); setPage('stress'); }} />}{page === 'account' && <Account ctx={ctx} />}</main>
      <footer className="site-footer"><span><span className="brand-mini">&gt;_</span> Competitive programming workspace.</span><span>AlgoWorkbench <span className="accent">✦</span></span></footer>
    </div>
    {help && <Modal title="Quick start guide" wide onClose={() => setHelp(false)}><div className="guide"><div><Terminal className="accent" /><h3>Online IDE</h3><p>Choose a language, write your solution, and add standard input. Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to run. Sign in first to use the compiler.</p></div><div><FlaskConical className="purple-text" /><h3>Stress testing</h3><p>Put a trusted brute-force solution beside your optimized one. Configure an array or pair generator, or write your own. The lab stops at the first failure.</p></div><div><FolderOpen className="accent" /><h3>Saved work</h3><p>Save solutions to your account with <kbd>Ctrl</kbd> + <kbd>S</kbd>. Completed stress runs can be saved from the results panel. Browser drafts also save as you type.</p></div><div><PanelsTopLeft className="purple-text" /><h3>Whiteboard</h3><p>Draw with the pen, shapes, arrows, and text. Insert arrays, trees, or graphs. Select and move elements, undo changes, and export PNG, SVG, or editable JSON. Hold <kbd>Space</kbd> to pan. Save boards to your account to reopen them.</p></div></div></Modal>}
  </div>;
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null); const [client, setClient] = useState<SupabaseClient | null>(null); const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false); const [loadError, setLoadError] = useState(''); const [authOpen, setAuthOpen] = useState(false); const [toast, setToast] = useState('');
  useEffect(() => {
    let alive = true; let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const response = await fetch('/api/config');
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The backend API is not responding correctly. Check the deployment routing and server logs.');
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'The backend API is unavailable. Check the deployment settings and try again.');
        const data = body as AppConfig;
        if (!data.supabaseUrl || !data.supabasePublishableKey || !Array.isArray(data.languages)) throw new Error('The backend configuration is incomplete. Check the server environment variables and redeploy.');
        if (!alive) return; setConfig(data);
        if (data.supabaseUrl && data.supabasePublishableKey) {
          const supabase = createClient(data.supabaseUrl, data.supabasePublishableKey); setClient(supabase);
          const { data: listener } = supabase.auth.onAuthStateChange((event, current) => {
            if (!alive) return;
            // Keep the work a guest just wrote when they sign in to run it.
            if (event === 'SIGNED_IN' && current) {
              for (const feature of ['ide', 'stress', 'whiteboard']) {
                try {
                  const target = `awb-${feature}-${current.user.id}`;
                  const guest = localStorage.getItem(`awb-${feature}-guest`);
                  if (guest && !localStorage.getItem(target)) localStorage.setItem(target, guest);
                } catch { /* Authentication still works if browser storage is unavailable. */ }
              }
            }
            setSession(current); setAuthReady(true);
          });
          unsubscribe = () => listener.subscription.unsubscribe();
          const { data: current } = await supabase.auth.getSession(); if (alive) { setSession(current.session); setAuthReady(true); }
        } else setAuthReady(true);
      } catch (e) { if (alive) setLoadError(e instanceof Error ? e.message : 'Could not connect to the API server.'); }
    })();
    return () => { alive = false; unsubscribe?.(); };
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  const notify = useCallback((message: string) => setToast(message), []);
  const closeAuth = useCallback(() => setAuthOpen(false), []);
  if (loadError) return <div className="boot-screen"><span className="boot-logo">&gt;_</span><h1>Unable to load workspace</h1><p>{loadError}</p><button className="button primary" onClick={() => location.reload()}>Try again</button></div>;
  if (!config || !authReady) return <div className="boot-screen"><span className="boot-logo">&gt;_</span><p>Setting up your workbench…</p></div>;
  const ctx: AppContext = { client, config, session, owner: session?.user.id || 'guest', requireAuth: () => { if (session) return true; setAuthOpen(true); return false; }, notify };
  return <><Workbench key={ctx.owner} ctx={ctx} />{authOpen && <Auth ctx={ctx} onClose={closeAuth} />}{toast && <div className="toast" role="status"><Check size={17} />{toast}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast('')}><X size={15} /></button></div>}</>;
}
