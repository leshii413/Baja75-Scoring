import { useState } from 'react';
import { useStore } from './store/store';
import { Icon, useRoute } from './ui/common';
import { Dashboard } from './screens/Dashboard';
import { Races } from './screens/Races';
import { EventPage } from './screens/EventPage';
import { ImportData } from './screens/ImportData';
import { Penalties } from './screens/Penalties';
import { Classes } from './screens/Classes';
import { Drivers } from './screens/Drivers';
import { Overall } from './screens/Overall';
import { SettingsPage } from './screens/SettingsPage';
import { Presets } from './screens/Presets';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { BrandMark } from './ui/Logo';

const NAV: [string, string, string][] = [
  ['dashboard', 'Dashboard', 'dash'], ['races', 'Races', 'flag'], ['import', 'Import Data', 'upload'], ['penalties', 'Penalties', 'timer'],
  ['classes', 'Classes & Vehicles', 'car'], ['drivers', 'Drivers', 'user'], ['overall', 'Overall Score', 'trophy'], ['presets', 'Presets', 'layers'], ['settings', 'Settings / Backup', 'gear'],
];

export function App() {
  const { ds, save, commit, pending } = useStore();
  const [route, go] = useRoute();
  const [menu, setMenu] = useState(false);
  const settings = ds.settings[0];
  const seasonId = settings?.selectedSeasonId ?? ds.seasons[0]?.id ?? '';
  const unassigned = ds.runs.filter((r) => !r.driverId || !r.eventId || r.held).length;
  const tab = route[0];
  let page;
  if (tab === 'races' && route[1]) page = <EventPage eventId={route[1]} go={go} />;
  else if (tab === 'races') page = <Races go={go} seasonId={seasonId} />;
  else if (tab === 'import') page = <ImportData go={go} seasonId={seasonId} />;
  else if (tab === 'penalties') page = <Penalties seasonId={seasonId} />;
  else if (tab === 'classes') page = <Classes />;
  else if (tab === 'drivers') page = <Drivers />;
  else if (tab === 'overall') page = <Overall seasonId={seasonId} go={go} />;
  else if (tab === 'settings') page = <SettingsPage />;
  else if (tab === 'presets') page = <Presets />;
  else page = <Dashboard go={go} seasonId={seasonId} />;

  return (
    <div className="app">
      <aside className={'side' + (menu ? ' open' : '')} onClick={() => setMenu(false)}>
        <div className="brand"><BrandMark /><div><b>Baja75 Scoring</b><span>Management System</span></div></div>
        <nav className="nav" aria-label="Main">
          {NAV.map(([id, label, icon]) => (
            <a key={id} href={'#/' + id} aria-current={tab === id || (id === 'dashboard' && !NAV.some((n) => n[0] === tab)) ? 'page' : undefined}>
              <Icon name={icon} />{label}{id === 'import' && unassigned > 0 && <span className="badge" aria-label={`${unassigned} to review`}>{unassigned}</span>}
            </a>
          ))}
        </nav>
      </aside>
      <div className="main">
        <header className="top">
          <button className="menu-btn ghost" aria-label="Open menu" onClick={() => setMenu(true)}><Icon name="menu" /></button>
          <label className="row" style={{ gap: 8 }}>
            <span className="small muted">Season</span>
            <select value={seasonId} onChange={(e) => commit((d) => ({ ...d, settings: [{ ...d.settings[0], selectedSeasonId: e.target.value }] }))} aria-label="Selected season">
              {ds.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="grow" />
          {pending && <span className="chip warn" role="status">IMPORT NOT COMMITTED YET</span>}
          <span className={'save ' + save.kind} role="status" aria-live="polite">
            <span className="dot" aria-hidden="true" />
            {save.kind === 'saved' ? 'All changes saved on this device' : save.kind === 'saving' ? 'Saving…' : save.kind === 'error' ? save.message : 'Opening…'}
          </span>
        </header>
        <main className="content" id="main">{page}</main>
      </div>
      <UpdatePrompt />
    </div>
  );
}
