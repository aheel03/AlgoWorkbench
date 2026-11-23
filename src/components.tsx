import { useEffect, useRef, type ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import type { Language } from './types';
import { languageNames } from './lib';

export function LanguageSelect({ value, onChange, label = 'Programming language' }: { value: Language; onChange: (l: Language) => void; label?: string }) {
  return <select aria-label={label} value={value} onChange={e => onChange(e.target.value as Language)}>{Object.entries(languageNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>;
}
export function Editor({ code, language, onChange, height = '440px', label = 'Source code' }: { code: string; language: Language; onChange: (v: string) => void; height?: string; label?: string }) {
  const extension = language === 'python' ? python() : language === 'java' ? java() : language === 'javascript' ? javascript() : cpp();
  return <CodeMirror aria-label={label} value={code} height={height} theme={oneDark} extensions={[extension]} onChange={onChange} basicSetup={{ foldGutter: true, highlightActiveLine: true, autocompletion: true, tabSize: 4 }} indentWithTab />;
}
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('button,input,select,textarea,a[href],[tabindex="0"]') || [])].filter(e => !e.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const items = focusable(); const first = items[0]; const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>{children}</div></div>;
}
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return <button className="icon-button" aria-label={copied ? 'Copied' : 'Copy output'} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { setCopied(false); } }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>;
}
export function Dino({ small = false }: { small?: boolean }) {
  return <svg className={`pixel-dino ${small ? 'small' : ''}`} width="84" height="80" viewBox="0 0 21 20" fill="currentColor" shapeRendering="crispEdges" aria-hidden="true"><path d="M12 1h7v1h1v6h-5v2h3v1h-4v3h-2v2h-2v3H8v-1H7v-3H5v-1H3v-2H2V7h1v3h2v1h4V9h2V2h1z"/><path d="M12 15h2v4h-1v-1h-1z"/><path fill="#101218" d="M16 3h1v1h-1z"/></svg>;
}
export function ErrorBox({ message }: { message: string | null }) { return message ? <div className="error-box" role="alert">{message}</div> : null; }
