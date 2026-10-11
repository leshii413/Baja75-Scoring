import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useStore } from '../store/store';

/** A new version is ready: reload only when the person says so, and not while an import is waiting to be committed. */
export function UpdatePrompt() {
  const { pending, save } = useStore();
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW();
  useEffect(() => { if (offlineReady) { const t = setTimeout(() => setOfflineReady(false), 5000); return () => clearTimeout(t); } }, [offlineReady, setOfflineReady]);
  if (!needRefresh && !offlineReady) return null;
  const busy = pending || save.kind === 'saving';
  return (
    <div className="toast sw no-print" role="status" aria-live="polite">
      {needRefresh ? (
        <>
          <p style={{ margin: '0 0 8px' }}><b>An update is ready.</b> {busy ? 'Finish or cancel the import in progress first: updating reloads the app.' : 'Your saved data stays.'}</p>
          <div className="row">
            <button className="primary small" disabled={busy} onClick={() => updateServiceWorker(true)}>Update now</button>
            <button className="small" onClick={() => setNeedRefresh(false)}>Later</button>
          </div>
        </>
      ) : (
        <div className="row"><span>Ready to work offline.</span><button className="small" onClick={() => setOfflineReady(false)}>OK</button></div>
      )}
    </div>
  );
}
