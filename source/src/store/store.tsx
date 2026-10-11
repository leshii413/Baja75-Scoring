import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Dataset } from '../domain/types';
import { loadAll, replaceAll, saveDiff } from './db';

export type SaveState = { kind: 'loading' } | { kind: 'saved'; at: number } | { kind: 'saving' } | { kind: 'error'; message: string };

interface Store {
  ds: Dataset;
  save: SaveState;
  /** Applies a change and saves it. The screen shows the change only once it is stored. Returns false if it couldn't be saved. */
  commit: (fn: (ds: Dataset) => Dataset) => Promise<boolean>;
  replace: (ds: Dataset) => Promise<boolean>;
  /** something typed or imported but not committed yet (the update prompt waits for it) */
  pending: boolean;
  setPending: (key: string, on: boolean) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ds, setDs] = useState<Dataset | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: 'loading' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const cur = useRef<Dataset | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    loadAll().then(({ ds }) => { cur.current = ds; setDs(ds); setSave({ kind: 'saved', at: Date.now() }); })
      .catch((e) => setLoadError(String(e?.message ?? e)));
  }, []);

  const commit = useCallback((fn: (ds: Dataset) => Dataset) => {
    const p = queue.current.then(async () => {
      const prev = cur.current!;
      let next: Dataset;
      try { next = fn(prev); } catch (e) { setSave({ kind: 'error', message: 'Not saved: ' + String((e as Error)?.message ?? e) }); return false; }
      if (next === prev) return true;
      setSave({ kind: 'saving' });
      try {
        await saveDiff(prev, next);
        cur.current = next; setDs(next); setSave({ kind: 'saved', at: Date.now() });
        return true;
      } catch (e) {
        const msg = String((e as Error)?.name === 'QuotaExceededError' ? 'the device is out of storage space' : (e as Error)?.message ?? e);
        setSave({ kind: 'error', message: 'Not saved: ' + msg + '. Your last saved data is unchanged.' });
        return false;
      }
    });
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  const replace = useCallback(async (next: Dataset) => {
    setSave({ kind: 'saving' });
    try { await replaceAll(next); cur.current = next; setDs(next); setSave({ kind: 'saved', at: Date.now() }); return true; }
    catch (e) { setSave({ kind: 'error', message: 'Not saved: ' + String((e as Error)?.message ?? e) }); return false; }
  }, []);

  const setPending = useCallback((key: string, on: boolean) => {
    setPendingKeys((s) => { const n = new Set(s); if (on) n.add(key); else n.delete(key); return n; });
  }, []);

  if (loadError) return <div className="fatal" role="alert"><h1>Baja75 Scoring Management System</h1><p>Your data could not be opened: {loadError}</p><p>This browser may block storage (private window, or site data blocked). Open the app in a normal window.</p></div>;
  if (!ds) return <div className="fatal"><p>Opening your data…</p></div>;
  return <Ctx.Provider value={{ ds, save, commit, replace, pending: pendingKeys.size > 0, setPending }}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('No store');
  return s;
}
