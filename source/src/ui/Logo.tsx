import { useState } from 'react';
import { history } from '../domain/actions';
import { useStore } from '../store/store';
import { Icon, useToast } from './common';

const MAX_IN = 2 * 1024 * 1024;   // largest picture accepted
const MAX_SVG = 300 * 1024;       // an SVG is kept as it is
const SIDE = 256;                 // pictures are scaled to fit 256 x 256 (keeps backups small)

/** The logo in the menu: the one chosen in Settings, or the built-in B75 mark. */
export function BrandMark() {
  const { ds } = useStore();
  const logo = ds.settings[0]?.logo;
  if (logo) return <img className="brand-logo" src={logo} alt="" />;
  return <div className="brand-mark" aria-hidden="true">B75</div>;
}

function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
}

export async function imageToLogo(f: File): Promise<string> {
  if (f.size > MAX_IN) throw new Error('That picture is over 2 MB');
  if (f.type === 'image/svg+xml' || /\.svg$/i.test(f.name)) {
    if (f.size > MAX_SVG) throw new Error('That SVG is over 300 KB');
    const url = await readAsDataUrl(f);
    return url.startsWith('data:image/svg+xml') ? url : 'data:image/svg+xml;base64,' + url.split(',')[1];
  }
  if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) throw new Error('Use a PNG, JPG, WebP, GIF or SVG picture');
  const url = await readAsDataUrl(f);
  const img = new Image();
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('That picture could not be opened')); img.src = url; });
  const k = Math.min(1, SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

export function LogoSetting() {
  const { ds, commit } = useStore();
  const toast = useToast();
  const [err, setErr] = useState<string | null>(null);
  const logo = ds.settings[0]?.logo ?? null;
  const set = (v: string | null) => commit((d) => history({ ...d, settings: [{ ...d.settings[0], logo: v }] }, 'logo', 'settings', 'settings', d.settings[0].logo ? 'custom' : 'default', v ? 'custom' : 'default', ''));
  return (
    <div className="stack">
      <p className="small muted">The logo at the top of the menu. A square picture works best; it's scaled to fit and saved with your data (and in backups).</p>
      <div className="row">
        <div className="logo-preview">{logo ? <img src={logo} alt="Current logo" /> : <div className="brand-mark" aria-label="Built-in B75 logo">B75</div>}</div>
        <label className="btn"><Icon name="upload" />Choose logo…<input type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg"
          onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
            try { const v = await imageToLogo(f); setErr(null); if (await set(v)) toast('Logo changed'); } catch (x) { setErr(String((x as Error).message ?? x)); }
          }} /></label>
        {logo && <button onClick={() => set(null).then((ok) => ok && toast('Back to the B75 logo'))}>Use the B75 logo</button>}
      </div>
      {err && <p className="small" role="alert" style={{ color: 'var(--bad)' }}>{err}</p>}
    </div>
  );
}
