// Live timing: talking to the Baja75 live relay (see live/relay in the repo) and estimating penalties while a race runs.
import type { Metric, PenaltyRule } from './types';

export type LiveState = 'running' | 'finished' | 'dnf' | 'idle' | 'unknown';
export interface LiveDriver {
  key: string; name: string; number: string; vehicle: string; navUnit: boolean; unit: string;
  state: LiveState; elapsedMs: number | null; finishMs: number | null; rm: number | null; routeMiles: number | null;
  lap: number | null; laps: number | null; vcp: [number, number] | null;
  counters: Partial<Record<Metric, number>>; serverResets: number;
  pos: [number, number] | null; z: number | null; speedKmh: number | null; heading: number | null;
  lastSeen: number; lastNav: number; rank: number | null;
}
export interface LiveRace {
  id: string; name: string; course: string; map: string; server: string; status: 'live' | 'ended';
  startedAt: number; updatedAt: number; route: [number, number][] | null; drivers: LiveDriver[]; now: number;
  trails?: Record<string, [number, number][]>;
}
export interface LiveRaceSummary { id: string; name: string; map: string; server: string; status: 'live' | 'ended'; startedAt: number; updatedAt: number; drivers: number; running: number; finished: number }

/**
 * Reads the relay address (and a race, if the link names one) from whatever was pasted: the iframe embed code, an
 * /embed link, or just the address. Returns null if there is no http(s) address in it.
 */
export function parseLiveLink(text: string): { base: string; raceId: string | null } | null {
  const t = String(text ?? '').trim();
  const m = /(https?:\/\/[^\s"'<>]+)/i.exec(t);
  if (!m) return null;
  let u: URL;
  try { u = new URL(m[1]); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const race = /\/(?:embed|api\/races)\/([\w-]{1,120})/.exec(u.pathname);
  return { base: u.origin, raceId: race ? race[1] : null };
}

export const embedCode = (base: string, raceId?: string | null) =>
  `<iframe src="${base}/embed${raceId ? '/' + raceId : ''}" title="Baja75 live results" width="100%" height="640" style="border:0;border-radius:8px" loading="lazy"></iframe>`;

/** Resets: the larger of what the Navigation Unit counted and what the server saw. */
export const liveResets = (d: LiveDriver) => Math.max(d.counters.resets ?? 0, d.serverResets ?? 0);

/** Penalty seconds so far with a Penalty Sheet's rules (an estimate: the official result comes from the run log). */
export function estimatePenaltyMs(d: LiveDriver, rules: PenaltyRule[]): number {
  let ms = 0;
  for (const r of rules) {
    if (!r.enabled || !r.seconds) continue;
    const count = r.metric === 'resets' ? liveResets(d) : d.counters[r.metric] ?? 0;
    ms += count * r.seconds * 1000;
  }
  return ms;
}

/** Elapsed time shown for a driver, moving on smoothly between updates while they're on course. */
export function liveElapsed(d: LiveDriver, sinceUpdateMs: number): number | null {
  if (d.state === 'finished') return d.finishMs ?? d.elapsedMs;
  if (d.state !== 'running' || d.elapsedMs == null) return d.elapsedMs;
  return d.elapsedMs + Math.max(0, Math.min(sinceUpdateMs, 15000));
}
