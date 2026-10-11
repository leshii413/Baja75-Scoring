// Durations, timestamps and formatting. Every time is an integer number of milliseconds.

export interface ParsedDuration { ms: number; precisionMs: number }

/**
 * "4:16.8", "0:09.9", "1:04:16.8", "16.8", "4:16", "4:16.812" -> integer ms.
 * "4:16.8" is 4 minutes 16.8 seconds, never 4.168 minutes.
 */
export function parseDuration(text: string): ParsedDuration | null {
  const t = String(text ?? '').trim();
  const m = /^(?:(\d{1,3}):)?(?:(\d{1,3}):)?(\d{1,2})(?:\.(\d{1,3}))?$/.exec(t);
  if (!m) return null;
  let h = 0, min = 0;
  if (m[1] !== undefined && m[2] !== undefined) { h = Number(m[1]); min = Number(m[2]); if (min > 59) return null; }
  else if (m[1] !== undefined) { min = Number(m[1]); }
  const sec = Number(m[3]);
  if ((m[1] !== undefined) && sec > 59) return null;
  if (m[1] !== undefined && m[2] !== undefined && m[2].length !== 2) return null;
  if (m[1] !== undefined && m[3].length !== 2) return null;
  const frac = m[4] ?? '';
  const fracMs = frac === '' ? 0 : Number((frac + '00').slice(0, 3));
  const precisionMs = frac.length === 0 ? 1000 : frac.length === 1 ? 100 : frac.length === 2 ? 10 : 1;
  const ms = ((h * 60 + min) * 60 + sec) * 1000 + fracMs;
  if (!Number.isSafeInteger(ms)) return null;
  return { ms, precisionMs };
}

/** JSON seconds (e.g. 256.812) -> integer ms. */
export function secondsToMs(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
  const ms = Math.round(v * 1000);
  return Number.isSafeInteger(ms) ? ms : null;
}

/** 256800 -> "4:16.8", 3_856_800 -> "1:04:16.8"; sub-tenth precision shows 3 decimals. */
export function formatMs(ms: number | null | undefined, opts: { plus?: boolean } = {}): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const neg = ms < 0; let v = Math.abs(Math.trunc(ms));
  const fracMs = v % 1000; v = Math.floor(v / 1000);
  const s = v % 60; v = Math.floor(v / 60);
  const m = v % 60; const h = Math.floor(v / 60);
  const frac = fracMs % 100 === 0 ? String(fracMs / 100) : String(fracMs).padStart(3, '0');
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${frac}` : `${m}:${String(s).padStart(2, '0')}.${frac}`;
  return (neg ? '-' : opts.plus ? '+' : '') + body;
}

export interface ParsedTimestamp { local: string; offsetMinutes: number | null; zoneName: string; utcIso: string | null; localDate: string }

/** "2026-10-07 08:38:06 UTC+08:00 (Malay Peninsula Standard Time)" */
export function parseTimestamp(text: string): ParsedTimestamp | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\s+UTC([+-])(\d{2}):?(\d{2}))?(?:\s+\((.*)\))?\s*$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const [y, mo, d, hh, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const ss = m[6] ? Number(m[6]) : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mi > 59 || ss > 59) return null;
  const local = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}${m[6] ? ':' + m[6] : ''}`;
  let offsetMinutes: number | null = null, utcIso: string | null = null;
  if (m[7]) {
    offsetMinutes = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
    const utc = Date.UTC(y, mo - 1, d, hh, mi, ss) - offsetMinutes * 60000;
    utcIso = new Date(utc).toISOString().replace('.000Z', 'Z');
  }
  return { local, offsetMinutes, zoneName: m[10] ?? '', utcIso, localDate: `${m[1]}-${m[2]}-${m[3]}` };
}

export function nowIso(): string { return new Date().toISOString(); }
