import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { checkSeconds } from '../domain/penalties';
import type { EntryStatus } from '../domain/types';

// ------------------------------------------------------------------ icons (labelled by the text beside them)
const P: Record<string, string> = {
  dash: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-10h8V3h-8z',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  upload: 'M12 16V4m0 0l-5 5m5-5l5 5M4 20h16',
  timer: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 100-16 8 8 0 000 16z',
  car: 'M5 17h14M6 17v2m12-2v2M4 13l2-6h12l2 6v4H4z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 9a8 8 0 0116 0',
  trophy: 'M8 21h8m-4-4v4M7 4h10v5a5 5 0 01-10 0zM7 6H4v2a3 3 0 003 3m10-5h3v2a3 3 0 01-3 3',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14.5 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2l.4 2.6h4l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  menu: 'M4 6h16M4 12h16M4 18h16',
  down: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z',
};
export function Icon({ name }: { name: keyof typeof P | string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name] ?? ''} /></svg>;
}

export function StatusChip({ status, pending }: { status: EntryStatus; pending?: boolean }) {
  if (pending) return <span className="chip warn">PENDING</span>;
  const cls = status === 'FINISHED' ? 'ok' : status === 'DNF' ? 'warn' : 'bad';
  return <span className={'chip ' + cls}>{status}</span>;
}

export function EventStatusChip({ status }: { status: 'draft' | 'finalized' | 'amending' }) {
  return status === 'finalized' ? <span className="chip ok">FINALIZED</span> : status === 'amending' ? <span className="chip warn">AMENDING</span> : <span className="chip info">DRAFT</span>;
}

// ------------------------------------------------------------------ hash routing: #/races/<eventId>
export function useRoute(): [string[], (path: string) => void] {
  const read = () => (window.location.hash.replace(/^#\/?/, '') || 'dashboard').split('/').map(decodeURIComponent);
  const [r, setR] = useState(read);
  useEffect(() => { const on = () => { setR(read()); window.scrollTo(0, 0); }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const go = useCallback((path: string) => { window.location.hash = '#/' + path; }, []);
  return [r, go];
}

// ------------------------------------------------------------------ toast
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | undefined>(undefined);
  const show = useCallback((m: string) => { setMsg(m); window.clearTimeout(t.current); t.current = window.setTimeout(() => setMsg(null), 4500); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status" aria-live="polite">{msg}</div>}</ToastCtx.Provider>;
}
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------ dialog
export function Dialog({ open, title, onClose, children, foot }: { open: boolean; title: string; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-label={title}>
      {open && <><div className="dlg-body"><h2>{title}</h2>{children}</div>{foot && <div className="dlg-foot">{foot}</div>}</>}
    </dialog>
  );
}

/** Asks for a written reason before a scoring change. */
export function useReason(): [ReactNode, (title: string, help: string, then: (reason: string) => void, initial?: string) => void] {
  const [st, setSt] = useState<{ title: string; help: string; then: (r: string) => void } | null>(null);
  const [text, setText] = useState('');
  const ask = useCallback((title: string, help: string, then: (r: string) => void, initial = '') => { setText(initial); setSt({ title, help, then }); }, []);
  const ok = text.trim().length > 0;
  const node = (
    <Dialog open={!!st} title={st?.title ?? ''} onClose={() => setSt(null)}
      foot={<><button onClick={() => setSt(null)}>Cancel</button><button className="primary" disabled={!ok} onClick={() => { const f = st!.then; setSt(null); f(text.trim()); }}>Save</button></>}>
      <p className="muted">{st?.help}</p>
      <label className="field">Reason (required)<textarea style={{ minHeight: 80 }} value={text} onChange={(e) => setText(e.target.value)} autoFocus /></label>
    </Dialog>
  );
  return [node, ask];
}

// ------------------------------------------------------------------ inputs
export function SecondsInput({ value, onCommit, label, disabled }: { value: number | null; onCommit: (v: number | null) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(value === null ? '' : String(value)); setErr(null); }, [value]);
  const commit = () => {
    const c = checkSeconds(text);
    if (!c.ok) { setErr(c.error); return; }
    setErr(null);
    if (c.value !== value) onCommit(c.value);
  };
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <input className="secs" inputMode="numeric" aria-label={label} aria-invalid={!!err} value={text} disabled={disabled}
        onChange={(e) => { setText(e.target.value); const c = checkSeconds(e.target.value); setErr(c.ok ? null : c.error); }}
        onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} placeholder="unset" />
      <span className="small muted">s</span>
      {err && <span className="small" role="alert" style={{ color: 'var(--bad)' }}>{err}</span>}
    </span>
  );
}

export function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function safeFile(s: string) { return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export'; }

export function readFileText(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result ?? '')); r.onerror = () => rej(r.error); r.readAsText(f, 'utf-8'); });
}

// ------------------------------------------------------------------ override prompt for protected changes
export const OVERRIDE_WORD = 'OVERRIDE';
export const OVERRIDE_SECONDS = 5;

export interface OverrideAsk { title: string; what: string[]; then: (reason: string) => void; danger?: boolean }

/**
 * Changing or deleting seasons, results and drivers goes through this prompt: the person reads what will happen,
 * types OVERRIDE, gives a reason, and the button only unlocks after a 5 second wait.
 */
export function useOverride(): [ReactNode, (o: OverrideAsk) => void] {
  const [st, setSt] = useState<OverrideAsk | null>(null);
  const [word, setWord] = useState('');
  const [reason, setReason] = useState('');
  const [left, setLeft] = useState(OVERRIDE_SECONDS);
  useEffect(() => {
    if (!st) return;
    setLeft(OVERRIDE_SECONDS);
    const started = Date.now();
    const t = window.setInterval(() => {
      const l = Math.max(0, OVERRIDE_SECONDS - Math.floor((Date.now() - started) / 1000));
      setLeft(l);
      if (l === 0) window.clearInterval(t);
    }, 200);
    return () => window.clearInterval(t);
  }, [st]);
  const ask = useCallback((o: OverrideAsk) => { setWord(''); setReason(''); setSt(o); }, []);
  const ready = left === 0 && word.trim().toUpperCase() === OVERRIDE_WORD && reason.trim().length > 0;
  const node = (
    <Dialog open={!!st} title={st?.title ?? ''} onClose={() => setSt(null)}
      foot={<><button onClick={() => setSt(null)}>Cancel</button>
        <button className={st?.danger ? 'danger' : 'primary'} disabled={!ready} onClick={() => { const f = st!.then; setSt(null); f(reason.trim()); }} aria-live="polite">
          <Icon name="lock" />{left > 0 ? `Override (${left})` : 'Override'}</button></>}>
      <div className="notice bad"><b>Protected change.</b> This changes or removes saved race data.
        <ul>{st?.what.map((w) => <li key={w}>{w}</li>)}</ul>
        <span className="small">Recorded in the change history. Download a backup first if you may want it back.</span></div>
      <div className="stack">
        <label className="field">Type {OVERRIDE_WORD} to confirm<input value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoFocus aria-invalid={word !== '' && word.trim().toUpperCase() !== OVERRIDE_WORD} /></label>
        <label className="field">Reason (required)<textarea style={{ minHeight: 70 }} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {left > 0 && <p className="small muted" role="timer">The override unlocks in {left} s.</p>}
      </div>
    </Dialog>
  );
  return [node, ask];
}
