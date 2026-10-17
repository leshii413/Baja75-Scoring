import { describe, expect, it } from 'vitest';
import { embedCode, estimatePenaltyMs, liveElapsed, parseLiveLink, type LiveDriver } from '../live';
import { templateRules } from '../penalties';

const d = (o: Partial<LiveDriver> = {}): LiveDriver => ({ key: 'k', name: 'A', number: '', vehicle: '', navUnit: true, unit: '', state: 'running', elapsedMs: 60000, finishMs: null,
  rm: null, routeMiles: null, lap: null, laps: null, vcp: null, counters: {}, serverResets: 0, pos: null, z: null, speedKmh: null, heading: null, lastSeen: 0, lastNav: 0, rank: 1, ...o });

describe('live link parsing', () => {
  it('reads the relay address from embed code, an embed link or a bare address', () => {
    expect(parseLiveLink('<iframe src="https://baja75-live.me.workers.dev/embed" width="100%"></iframe>')).toEqual({ base: 'https://baja75-live.me.workers.dev', raceId: null });
    expect(parseLiveLink('https://baja75-live.me.workers.dev/embed/johnson-valley-race-20261017?view=map')).toEqual({ base: 'https://baja75-live.me.workers.dev', raceId: 'johnson-valley-race-20261017' });
    expect(parseLiveLink('  https://live.baja75series.com/  ')).toEqual({ base: 'https://live.baja75series.com', raceId: null });
    expect(parseLiveLink('no link here')).toBeNull();
    expect(parseLiveLink('javascript:alert(1)')).toBeNull();
  });
  it('embed code round-trips', () => {
    expect(parseLiveLink(embedCode('https://x.workers.dev', 'r-1'))).toEqual({ base: 'https://x.workers.dev', raceId: 'r-1' });
  });
});

describe('live estimates', () => {
  it('penalty estimate uses the sheet seconds, and the larger reset count', () => {
    const rules = templateRules().map((r) => ({ ...r, seconds: r.metric === 'offCourse' ? 30 : r.metric === 'resets' ? 10 : 0 }));
    expect(estimatePenaltyMs(d({ counters: { offCourse: 2, resets: 1 }, serverResets: 3 }), rules)).toBe(2 * 30000 + 3 * 10000);
    expect(estimatePenaltyMs(d({ counters: { offCourse: 2 } }), rules.map((r) => ({ ...r, enabled: false })))).toBe(0);
  });
  it('time keeps running between updates, but not for ever', () => {
    expect(liveElapsed(d(), 2000)).toBe(62000);
    expect(liveElapsed(d(), 60000)).toBe(75000);
    expect(liveElapsed(d({ state: 'finished', finishMs: 2274771 }), 5000)).toBe(2274771);
    expect(liveElapsed(d({ state: 'dnf', elapsedMs: 9000 }), 5000)).toBe(9000);
  });
});
