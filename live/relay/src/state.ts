// Baja75 live timing: the race state kept by the relay. Pure functions, no Cloudflare APIs, so they are unit-tested.
//
// The BeamMP server plugin (Baja75Live) pushes every player on the server every second (configurable). Players whose Navigation Unit
// reports a run on a course are grouped into a race per course (and map, and day). Each driver's positions are kept as
// a trail; together the trails draw the route on the live map, even without a route file.

export const COUNTERS = ['offCourse', 'wrongWay', 'speeding', 'missedVcps', 'jumpStarts', 'resets', 'recoveries', 'damageHits'] as const;
export type Counter = typeof COUNTERS[number];
export type DriverState = 'running' | 'finished' | 'dnf' | 'idle' | 'unknown';

/** What the Navigation Unit reports (via the server plugin). Every field is optional: older units send less. */
export interface NavReport {
  course?: string; state?: DriverState; elapsedMs?: number; finishMs?: number;
  rm?: number; routeMiles?: number; lap?: number; laps?: number; vcp?: [number, number];
  counters?: Partial<Record<Counter, number>>; number?: string; unit?: string;
}

export interface PushPlayer {
  pid?: number; name: string; beammp?: string; vehicle?: string;
  pos?: [number, number, number]; speed?: number; heading?: number;
  /** positions sampled since the previous push, oldest first (plugin sample mode); pos is the newest */
  track?: [number, number][];
  /** resets counted by the server (onVehicleReset) since the player joined */
  resets?: number;
  nav?: NavReport | null;
}

export interface PushPayload {
  v: number; server?: string; map?: string; t?: number;
  players: PushPlayer[];
  /** optional route polylines per course, from the server's data/routes folder: [[x, y], …] */
  routes?: Record<string, [number, number][]>;
}

export interface LiveDriver {
  key: string; name: string; number: string; vehicle: string; navUnit: boolean; unit: string;
  state: DriverState; elapsedMs: number | null; finishMs: number | null; rm: number | null; routeMiles: number | null;
  lap: number | null; laps: number | null; vcp: [number, number] | null;
  counters: Partial<Record<Counter, number>>;
  /** resets the server saw during this race (independent of the Navigation Unit) */
  serverResets: number;
  pos: [number, number] | null; z: number | null; speedKmh: number | null; heading: number | null;
  lastSeen: number; lastNav: number;
  rank: number | null;
}

export interface LiveRace {
  id: string; name: string; course: string; map: string; server: string;
  status: 'live' | 'ended'; startedAt: number; updatedAt: number;
  route: [number, number][] | null;
  drivers: LiveDriver[];
}

export interface Hub {
  races: Record<string, LiveRace>;
  trails: Record<string, Record<string, [number, number][]>>; // race id -> driver key -> points
  /** server resets per player at the moment they joined a race, so the race count starts at 0 */
  resetBase: Record<string, number>;
}

export const LIMITS = {
  /** a race with no running driver for this long is ended */
  endAfterMs: 10 * 60 * 1000,
  /** ended races are kept this long, then removed */
  keepEndedMs: 48 * 60 * 60 * 1000,
  /** a trail point is only added after the car moved this far (metres) */
  trailStepM: 12,
  maxTrailPoints: 8000,
  /** trails are stored in chunks of this many points; the oldest whole chunk goes when a trail is full */
  trailChunk: 1000,
  maxTrackPoints: 20,
  maxPlayers: 128,
  maxRoutePoints: 20000,
};

export function emptyHub(): Hub { return { races: {}, trails: {}, resetBase: {} }; }

export function slug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'race';
}

const num = (v: unknown, lo = -1e9, hi = 1e9): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const str = (v: unknown, max = 120): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');
const STATES: DriverState[] = ['running', 'finished', 'dnf', 'idle', 'unknown'];

/** Checks and trims a push. Anything malformed is dropped rather than trusted. */
export function cleanPayload(raw: unknown): PushPayload | null {
  const p = raw as PushPayload;
  if (!p || typeof p !== 'object' || !Array.isArray(p.players)) return null;
  const players: PushPlayer[] = [];
  for (const x of p.players.slice(0, LIMITS.maxPlayers)) {
    if (!x || typeof x !== 'object') continue;
    const name = str(x.name, 40); if (!name) continue;
    const pos = Array.isArray(x.pos) && x.pos.length >= 3 && x.pos.every((v) => num(v) !== null) ? [x.pos[0], x.pos[1], x.pos[2]] as [number, number, number] : undefined;
    let nav: NavReport | null = null;
    if (x.nav && typeof x.nav === 'object') {
      const n = x.nav;
      const counters: Partial<Record<Counter, number>> = {};
      if (n.counters && typeof n.counters === 'object') for (const c of COUNTERS) { const v = num((n.counters as Record<string, unknown>)[c], 0, 100000); if (v !== null) counters[c] = Math.round(v); }
      const vcp = Array.isArray(n.vcp) && n.vcp.length === 2 && num(n.vcp[0], 0, 10000) !== null && num(n.vcp[1], 0, 10000) !== null ? [n.vcp[0], n.vcp[1]] as [number, number] : undefined;
      nav = {
        course: str(n.course, 100) || undefined, state: STATES.includes(n.state as DriverState) ? n.state : undefined,
        elapsedMs: num(n.elapsedMs, 0, 864e5) ?? undefined, finishMs: num(n.finishMs, 0, 864e5) ?? undefined,
        rm: num(n.rm, 0, 10000) ?? undefined, routeMiles: num(n.routeMiles, 0, 10000) ?? undefined,
        lap: num(n.lap, 0, 1000) ?? undefined, laps: num(n.laps, 0, 1000) ?? undefined, vcp, counters,
        number: str(n.number, 8) || undefined, unit: str(n.unit, 40) || undefined,
      };
    }
    const track = Array.isArray(x.track) ? x.track.slice(0, LIMITS.maxTrackPoints).filter((q) => Array.isArray(q) && num(q[0]) !== null && num(q[1]) !== null).map((q) => [q[0], q[1]] as [number, number]) : undefined;
    players.push({ pid: num(x.pid, 0, 10000) ?? undefined, name, beammp: str(x.beammp, 40) || undefined, vehicle: str(x.vehicle, 80) || undefined, pos, track: track?.length ? track : undefined,
      speed: num(x.speed, 0, 500) ?? undefined, heading: num(x.heading, -10, 10) ?? undefined, resets: num(x.resets, 0, 1e6) ?? undefined, nav });
  }
  let routes: PushPayload['routes'];
  if (p.routes && typeof p.routes === 'object') {
    routes = {};
    for (const [k, v] of Object.entries(p.routes).slice(0, 20)) {
      if (!Array.isArray(v)) continue;
      const pts = v.slice(0, LIMITS.maxRoutePoints).filter((q) => Array.isArray(q) && num(q[0]) !== null && num(q[1]) !== null).map((q) => [q[0], q[1]] as [number, number]);
      if (pts.length > 1) routes[str(k, 100)] = pts;
    }
  }
  return { v: num(p.v, 0, 100) ?? 1, server: str(p.server, 80), map: str(p.map, 60), t: num(p.t) ?? undefined, players, routes };
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const driverKey = (p: PushPlayer) => (p.beammp ? 'bmp:' + p.beammp : 'name:' + p.name.toLowerCase());

function findRace(hub: Hub, course: string, map: string, now: number): LiveRace | undefined {
  // the newest race on this course that is still live (a new day or an ended race starts a new one)
  return Object.values(hub.races).filter((r) => r.course === course && r.map === map && r.status === 'live' && now - r.updatedAt < LIMITS.endAfterMs)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
}

function addTrailPoint(hub: Hub, raceId: string, key: string, pt: [number, number]): [number, number] | null {
  const t = (hub.trails[raceId] ??= {});
  const list = (t[key] ??= []);
  const last = list[list.length - 1];
  if (last && Math.hypot(pt[0] - last[0], pt[1] - last[1]) < LIMITS.trailStepM) return null;
  const p: [number, number] = [Math.round(pt[0] * 10) / 10, Math.round(pt[1] * 10) / 10];
  list.push(p);
  if (list.length > LIMITS.maxTrailPoints) list.splice(0, LIMITS.trailChunk);
  return p;
}

const STATE_ORDER: Record<DriverState, number> = { finished: 0, running: 1, dnf: 2, idle: 3, unknown: 4 };

/** Running order: finishers by finish time, then cars on course by lap, race mile and checkpoints, then DNF. */
export function rankDrivers(ds: LiveDriver[]): LiveDriver[] {
  const sorted = [...ds].sort((a, b) =>
    STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || (a.state === 'finished' ? (a.finishMs ?? a.elapsedMs ?? 9e15) - (b.finishMs ?? b.elapsedMs ?? 9e15) : 0)
    || (b.lap ?? 0) - (a.lap ?? 0)
    || (b.rm ?? -1) - (a.rm ?? -1)
    || (b.vcp?.[0] ?? -1) - (a.vcp?.[0] ?? -1)
    || (a.elapsedMs ?? 9e15) - (b.elapsedMs ?? 9e15)
    || a.name.localeCompare(b.name));
  let r = 0;
  for (const d of sorted) d.rank = d.navUnit && (d.state === 'finished' || d.state === 'running') ? ++r : null;
  return sorted;
}

/** Applies one push. Returns the ids of the races that changed and the trail points added to each. */
export function ingest(hub: Hub, payload: PushPayload, now: number): { changed: string[]; added: Record<string, Record<string, [number, number][]>> } {
  const changed = new Set<string>();
  const added: Record<string, Record<string, [number, number][]>> = {};
  const map = payload.map ?? '';
  const seenInRace = new Set<string>();

  for (const p of payload.players) {
    const nav = p.nav;
    const course = nav?.course;
    if (!course) continue;
    const active = nav.state === 'running' || nav.state === 'finished' || nav.state === 'dnf';
    let race = findRace(hub, course, map, now);
    if (!race) {
      if (nav.state !== 'running') continue; // a race starts when someone is on course
      const id = `${slug(map || 'map')}-${slug(course)}-${dayOf(now)}`;
      let unique = id, n = 2;
      while (hub.races[unique]) unique = `${id}-${n++}`;
      race = { id: unique, name: course, course, map, server: payload.server ?? '', status: 'live', startedAt: now, updatedAt: now, route: null, drivers: [] };
      hub.races[unique] = race;
    }
    const key = driverKey(p);
    let d = race.drivers.find((x) => x.key === key);
    if (!d) {
      if (!active) continue;
      d = { key, name: p.name, number: '', vehicle: '', navUnit: true, unit: '', state: 'unknown', elapsedMs: null, finishMs: null, rm: null, routeMiles: null,
        lap: null, laps: null, vcp: null, counters: {}, serverResets: 0, pos: null, z: null, speedKmh: null, heading: null, lastSeen: now, lastNav: now, rank: null };
      race.drivers.push(d);
      hub.resetBase[`${race.id}|${key}`] = p.resets ?? 0;
    }
    seenInRace.add(`${race.id}|${key}`);
    updateDriver(hub, race, d, p, now, added);
    d.navUnit = true; d.lastNav = now;
    if (nav.state) d.state = nav.state;
    if (nav.elapsedMs !== undefined) d.elapsedMs = nav.elapsedMs;
    if (nav.finishMs !== undefined) d.finishMs = nav.finishMs;
    if (d.state === 'finished' && d.finishMs === null) d.finishMs = d.elapsedMs;
    if (nav.rm !== undefined) d.rm = nav.rm;
    if (nav.routeMiles !== undefined) d.routeMiles = nav.routeMiles;
    if (nav.lap !== undefined) d.lap = nav.lap;
    if (nav.laps !== undefined) d.laps = nav.laps;
    if (nav.vcp) d.vcp = nav.vcp;
    if (nav.counters) d.counters = { ...d.counters, ...nav.counters };
    if (nav.number) d.number = nav.number;
    if (nav.unit) d.unit = nav.unit;
    race.updatedAt = now;
    changed.add(race.id);
  }

  // players without Navigation Unit data: shown on the map (position only) when exactly one race is live on this map
  const liveHere = Object.values(hub.races).filter((r) => r.status === 'live' && r.map === map && now - r.updatedAt < LIMITS.endAfterMs);
  if (liveHere.length === 1) {
    const race = liveHere[0];
    for (const p of payload.players) {
      if (p.nav?.course || !p.pos) continue;
      const key = driverKey(p);
      if (seenInRace.has(`${race.id}|${key}`)) continue;
      let d = race.drivers.find((x) => x.key === key);
      if (!d) {
        d = { key, name: p.name, number: '', vehicle: '', navUnit: false, unit: '', state: 'unknown', elapsedMs: null, finishMs: null, rm: null, routeMiles: null,
          lap: null, laps: null, vcp: null, counters: {}, serverResets: 0, pos: null, z: null, speedKmh: null, heading: null, lastSeen: now, lastNav: 0, rank: null };
        race.drivers.push(d);
        hub.resetBase[`${race.id}|${key}`] = p.resets ?? 0;
      }
      updateDriver(hub, race, d, p, now, added);
      changed.add(race.id);
    }
  }

  // routes sent by the server for a course
  if (payload.routes) for (const [course, pts] of Object.entries(payload.routes)) {
    const race = findRace(hub, course, map, now);
    if (race) { race.route = pts; changed.add(race.id); }
  }
  for (const id of changed) rankDrivers(hub.races[id].drivers).forEach((d, i) => { hub.races[id].drivers[i] = d; });
  return { changed: [...changed], added };
}

function updateDriver(hub: Hub, race: LiveRace, d: LiveDriver, p: PushPlayer, now: number, added: Record<string, Record<string, [number, number][]>>) {
  d.name = p.name;
  if (p.vehicle) d.vehicle = p.vehicle;
  d.lastSeen = now;
  if (p.resets !== undefined) d.serverResets = Math.max(0, p.resets - (hub.resetBase[`${race.id}|${d.key}`] ?? p.resets));
  if (p.speed !== undefined) d.speedKmh = Math.round(p.speed * 3.6);
  if (p.heading !== undefined) d.heading = p.heading;
  for (const q of p.track ?? []) {
    const pt = addTrailPoint(hub, race.id, d.key, q);
    if (pt) ((added[race.id] ??= {})[d.key] ??= []).push(pt);
  }
  if (p.pos) {
    d.pos = [Math.round(p.pos[0] * 10) / 10, Math.round(p.pos[1] * 10) / 10]; d.z = Math.round(p.pos[2]);
    const pt = addTrailPoint(hub, race.id, d.key, d.pos);
    if (pt) ((added[race.id] ??= {})[d.key] ??= []).push(pt);
  }
}

/** Ends quiet races and forgets old ones. Returns ids that changed. */
export function housekeeping(hub: Hub, now: number): string[] {
  const out: string[] = [];
  for (const r of Object.values(hub.races)) {
    if (r.status === 'live' && now - r.updatedAt >= LIMITS.endAfterMs) { r.status = 'ended'; out.push(r.id); }
    if (r.status === 'live' && r.drivers.length && r.drivers.every((d) => d.navUnit ? d.state === 'finished' || d.state === 'dnf' : true) && now - r.updatedAt > 2 * 60 * 1000) { r.status = 'ended'; out.push(r.id); }
    if (r.status === 'ended' && now - r.updatedAt > LIMITS.keepEndedMs) {
      delete hub.races[r.id]; delete hub.trails[r.id];
      for (const k of Object.keys(hub.resetBase)) if (k.startsWith(r.id + '|')) delete hub.resetBase[k];
    }
  }
  return out;
}

export interface RaceSummary { id: string; name: string; map: string; server: string; status: LiveRace['status']; startedAt: number; updatedAt: number; drivers: number; running: number; finished: number }
export function listRaces(hub: Hub): RaceSummary[] {
  return Object.values(hub.races).sort((a, b) => (a.status === b.status ? b.updatedAt - a.updatedAt : a.status === 'live' ? -1 : 1)).map((r) => ({
    id: r.id, name: r.name, map: r.map, server: r.server, status: r.status, startedAt: r.startedAt, updatedAt: r.updatedAt,
    drivers: r.drivers.filter((d) => d.navUnit).length, running: r.drivers.filter((d) => d.state === 'running').length, finished: r.drivers.filter((d) => d.state === 'finished').length,
  }));
}

/** The race as sent to viewers; trails only when asked (they can be large). */
export function raceView(hub: Hub, id: string, withTrails: boolean, now: number) {
  const r = hub.races[id];
  if (!r) return null;
  return { ...r, now, trails: withTrails ? hub.trails[id] ?? {} : undefined };
}
