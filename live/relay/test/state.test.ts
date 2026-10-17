import { describe, expect, it } from 'vitest';
import { cleanPayload, emptyHub, housekeeping, ingest, LIMITS, listRaces, raceView, type PushPayload } from '../src/state';

const COURSE = 'BAJA75 Series: October 3rd Race';
const T0 = Date.UTC(2026, 9, 17, 4, 0, 0);
function push(players: PushPayload['players'], extra: Partial<PushPayload> = {}): PushPayload {
  return cleanPayload({ v: 1, server: 'Baja75 Casual Server', map: 'johnson_valley', players, ...extra })!;
}
const nav = (o: Record<string, unknown> = {}) => ({ course: COURSE, state: 'running', elapsedMs: 60000, rm: 1.2, routeMiles: 24, counters: { offCourse: 0 }, ...o });

describe('live relay state', () => {
  it('a race starts when a driver is running on a course, and ranks by progress then finish time', () => {
    const hub = emptyHub();
    ingest(hub, push([
      { name: 'hilly', beammp: '11', pos: [0, 0, 0], speed: 30, nav: nav({ rm: 3.4, number: '413' }) },
      { name: 'DH_FOX911', beammp: '22', pos: [50, 0, 0], speed: 25, nav: nav({ rm: 5.0 }) },
    ]), T0);
    const races = listRaces(hub);
    expect(races).toHaveLength(1);
    expect(races[0]).toMatchObject({ name: COURSE, map: 'johnson_valley', status: 'live', drivers: 2, running: 2 });
    expect(races[0].id).toBe('johnsonvalley-baja75-series-october-3rd-race-20261017'.replace('johnsonvalley', 'johnson-valley'));
    let r = hub.races[races[0].id];
    expect(r.drivers.map((d) => [d.name, d.rank])).toEqual([['DH_FOX911', 1], ['hilly', 2]]);
    expect(r.drivers[1]).toMatchObject({ number: '413', speedKmh: 108 });
    // hilly finishes first, FOX later but faster
    ingest(hub, push([
      { name: 'hilly', beammp: '11', pos: [900, 0, 0], nav: nav({ state: 'finished', elapsedMs: 2312360, rm: 24 }) },
      { name: 'DH_FOX911', beammp: '22', pos: [905, 0, 0], nav: nav({ state: 'finished', elapsedMs: 2274771, rm: 24 }) },
    ]), T0 + 3000);
    r = hub.races[races[0].id];
    expect(r.drivers.map((d) => [d.name, d.rank, d.finishMs])).toEqual([['DH_FOX911', 1, 2274771], ['hilly', 2, 2312360]]);
  });

  it('keeps a trail per driver, only adding points after the car moved', () => {
    const hub = emptyHub();
    for (let i = 0; i < 10; i++) ingest(hub, push([{ name: 'A', pos: [i * 5, 0, 0], nav: nav() }]), T0 + i * 3000);
    const id = listRaces(hub)[0].id;
    const trail = Object.values(hub.trails[id])[0];
    expect(trail.length).toBeGreaterThan(2);
    expect(trail.length).toBeLessThan(10);
    expect(raceView(hub, id, true, T0)!.trails).toBeDefined();
    expect(raceView(hub, id, false, T0)!.trails).toBeUndefined();
  });

  it('server resets count from the moment the driver joined the race', () => {
    const hub = emptyHub();
    ingest(hub, push([{ name: 'A', resets: 7, pos: [0, 0, 0], nav: nav() }]), T0);
    ingest(hub, push([{ name: 'A', resets: 9, pos: [0, 0, 0], nav: nav({ counters: { offCourse: 2, resets: 2 } }) }]), T0 + 3000);
    const d = Object.values(hub.races)[0].drivers[0];
    expect(d.serverResets).toBe(2);
    expect(d.counters).toMatchObject({ offCourse: 2, resets: 2 });
  });

  it('players without the Navigation Unit show on the map of the single live race, unranked', () => {
    const hub = emptyHub();
    ingest(hub, push([{ name: 'A', pos: [0, 0, 0], nav: nav() }, { name: 'NoNav', pos: [10, 10, 0] }]), T0);
    const r = Object.values(hub.races)[0];
    const nn = r.drivers.find((d) => d.name === 'NoNav')!;
    expect(nn).toMatchObject({ navUnit: false, rank: null, pos: [10, 10] });
  });

  it('idle reports and freeroamers do not start a race', () => {
    const hub = emptyHub();
    ingest(hub, push([{ name: 'A', pos: [0, 0, 0], nav: nav({ state: 'idle' }) }, { name: 'B', pos: [0, 0, 0] }]), T0);
    expect(listRaces(hub)).toEqual([]);
  });

  it('a race ends after 10 quiet minutes, is kept 48 h, and the same course later starts a new race', () => {
    const hub = emptyHub();
    ingest(hub, push([{ name: 'A', pos: [0, 0, 0], nav: nav() }]), T0);
    const first = listRaces(hub)[0].id;
    expect(housekeeping(hub, T0 + LIMITS.endAfterMs + 1)).toEqual([first]);
    expect(hub.races[first].status).toBe('ended');
    ingest(hub, push([{ name: 'A', pos: [0, 0, 0], nav: nav() }]), T0 + LIMITS.endAfterMs + 5000);
    expect(listRaces(hub).map((r) => r.status)).toEqual(['live', 'ended']);
    expect(listRaces(hub)[0].id).toBe(first + '-2');
    housekeeping(hub, T0 + LIMITS.keepEndedMs + LIMITS.endAfterMs + 10);
    expect(hub.races[first]).toBeUndefined();
    expect(hub.trails[first]).toBeUndefined();
  });

  it('accepts a route from the server for a live course', () => {
    const hub = emptyHub();
    ingest(hub, push([{ name: 'A', pos: [0, 0, 0], nav: nav() }], { routes: { [COURSE]: [[0, 0], [100, 50], [200, 0]] } }), T0);
    expect(Object.values(hub.races)[0].route).toEqual([[0, 0], [100, 50], [200, 0]]);
  });

  it('drops malformed or hostile data instead of trusting it', () => {
    expect(cleanPayload({ nope: 1 })).toBeNull();
    const p = cleanPayload({ players: [
      { name: '<img src=x onerror=alert(1)>\u0007', pos: [1, 'x', 3], speed: -5, nav: { course: COURSE, state: 'hacking', elapsedMs: 1e12, counters: { offCourse: 'lots', speeding: 3 } } },
      { name: '' }, null, 5,
    ] })!;
    expect(p.players).toHaveLength(1);
    const x = p.players[0];
    expect(x.name).toBe('<img src=x onerror=alert(1)>'); // kept as text; the pages escape it
    expect(x.pos).toBeUndefined();
    expect(x.speed).toBeUndefined();
    expect(x.nav).toMatchObject({ state: undefined, elapsedMs: undefined, counters: { speeding: 3 } });
  });
});
