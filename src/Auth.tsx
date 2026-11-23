import { useState, type FormEvent } from 'react';
import { LogIn, UserPlus, ShieldCheck } from 'lucide-react';
import { Modal, ErrorBox } from './components';
import type { AppContext } from './types';
import { errorMessage } from './lib';

export function Auth({ ctx, onClose, initialMode = 'signup' }: { ctx: AppContext; onClose: () => void; initialMode?: 'signup' | 'signin' }) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!ctx.client) { setError('Supabase is not configured on the server.'); return; }
    setBusy(true); setError(null); setMessage('');
    try {
      if (mode === 'signup') {
        const { data, error } = await ctx.client.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (data.session) { ctx.notify('Account created. Welcome to your workbench!'); onClose(); }
        else setMessage('Check your inbox to confirm your email, then sign in. If this email is already registered, sign in to your existing account.');
      } else {
        const { error } = await ctx.client.auth.signInWithPassword({ email, password });
        if (error) throw error; ctx.notify('Welcome back. Let’s build something.'); onClose();
      }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return <Modal title={mode === 'signup' ? 'Create your account' : 'Welcome back'} onClose={onClose}>
    <div className="auth-intro"><div className="auth-icon">{mode === 'signup' ? <UserPlus /> : <LogIn />}</div><p>Sign in to run code and save your work.</p></div>
    <div className="segmented"><button className={mode === 'signup' ? 'selected' : ''} onClick={() => { setMode('signup'); setError(null); setMessage(''); }}>Create account</button><button className={mode === 'signin' ? 'selected' : ''} onClick={() => { setMode('signin'); setError(null); setMessage(''); }}>Sign in</button></div>
    <form onSubmit={submit} className="form-stack">
      {mode === 'signup' && <label>Username<input value={username} onChange={e => setUsername(e.target.value)} placeholder="your_handle" autoComplete="username" minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" title="3–24 letters, numbers, or underscores" required /></label>}
      <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>
      <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} minLength={mode === 'signup' ? 8 : 1} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required /></label>
      <ErrorBox message={error} />{message && <div className="success-box" role="status">{message}</div>}
      <button className="button primary full" disabled={busy}>{busy ? 'One moment…' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
    </form>
    <p className="auth-footnote"><ShieldCheck size={14} /> Secured with Supabase Authentication</p>
  </Modal>;
}
