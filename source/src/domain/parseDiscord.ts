// Race results posted to Discord by a BeamJoy Revived server webhook, pasted as copied from Discord:
//
//   hilly
//   BAJA75 Series: October 3rd Race
//   `38:32.360`
//   New server record, 0.579s faster than their old best
//   Leaderboard
//   #1 of 4
//   Best lap
//   `6:27.173`
//   Laps
//   4
//   Vehicle
//   SP Dunekicker (2008) (custom)
//   -►Baja75 Casual Server•10/6/2026 1:09 PM
//
// Several posts can be pasted at once. The post's server name is kept as a note only (any server works). What a post
// doesn't carry (race number, map, penalty counts) is recorded as "No Data Provided": the result still scores, flagged
// for manual review.

import { COL_METRIC, NO_DATA } from './csv';
import { fingerprint } from './ids';
import { emptyCounters, type ParsedRun, type ParseResult } from './parseLog';
import { parseDuration, parseTimestamp } from './time';

const TIME = /^`?\s*(\d{1,3}:\d{2}(?::\d{2})?(?:\.\d{1,3})?)\s*`?$/;
const LABELS = new Set(['best lap', 'laps', 'vehicle', 'record', 'leaderboard', 'position', 'gap', 'class']);
/** "server • date" footer; the bullet may be •, · or a spaced dash */
const FOOTER = /^(.*?)\s*[•·]\s*(.+)$/;

const clean = (s: string) => s.replace(/​/g, '').trim();
const isLabel = (s: string) => LABELS.has(s.toLowerCase().replace(/:$/, ''));

/** Quick check used by Import Data to route pasted text here. */
export function looksLikeDiscordResults(text: string): boolean {
  const lines = String(text).split(/\r?\n/).map(clean).filter(Boolean);
  const hasTime = lines.some((l, i) => i >= 2 && TIME.test(l) && l.includes('`'));
  const hasFooter = lines.some((l) => FOOTER.test(l) && /(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}|today|yesterday)/i.test(l));
  return hasTime && (hasFooter || lines.some((l) => /^vehicle:?$/i.test(l)));
}

function pad(n: number, w = 2) { return String(n).padStart(w, '0'); }

/** Local date + time on the importing device (Discord shows times in the viewer's own time zone). */
function stampFrom(y: number, mo: number, d: number, h: number, mi: number): string {
  const local = new Date(y, mo - 1, d, h, mi, 0);
  const off = -local.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:00 UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** "10/6/2026 1:09 PM", "Today at 9:39 AM", "Yesterday at 9:39 AM", "2026-10-06 13:09" -> timestamp text, or null. */
export function discordDate(text: string, now: Date): { stamp: string; relative: boolean } | null {
  const t = text.replace(/^at\s+/i, '').trim();
  const clock = (h: number, mi: number, ap?: string) => {
    if (ap) { const p = ap.toUpperCase(); if (h === 12) h = 0; if (p === 'PM') h += 12; }
    return h < 24 && mi < 60 ? [h, mi] as const : null;
  };
  let m = /^(today|yesterday)\s+at\s+(\d{1,2}):(\d{2})\s*([ap]m)?$/i.exec(t);
  if (m) {
    const c = clock(Number(m[2]), Number(m[3]), m[4]); if (!c) return null;
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (m[1].toLowerCase() === 'yesterday' ? 1 : 0));
    return { stamp: stampFrom(d.getFullYear(), d.getMonth() + 1, d.getDate(), c[0], c[1]), relative: true };
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T,]+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?$/i.exec(t);
  if (m) { const c = clock(Number(m[4]), Number(m[5]), m[6]); if (!c) return null; return { stamp: stampFrom(Number(m[1]), Number(m[2]), Number(m[3]), c[0], c[1]), relative: false }; }
  // US order as Discord shows it in English: month/day/year
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*([ap]m)?$/i.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const mo = Number(m[1]), d = Number(m[2]);
    const c = clock(Number(m[4]), Number(m[5]), m[6]);
    if (!c || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { stamp: stampFrom(y, mo, d, c[0], c[1]), relative: false };
  }
  return null;
}

export function parseDiscordResults(text: string, name = 'Discord paste', now: Date = new Date()): ParseResult {
  const out: ParseResult = { runs: [], rejected: [], notes: ['BeamJoy Revived results pasted from Discord.'] };
  const lines = String(text).split(/\r?\n/).map(clean);
  // a post starts two lines above its race time: driver, race title, `time` (the time isn't under a label)
  const prevText = (i: number) => { for (let j = i - 1; j >= 0; j--) if (lines[j]) return j; return -1; };
  const starts: { timeAt: number; raceAt: number; driverAt: number }[] = [];
  lines.forEach((l, i) => {
    if (!TIME.test(l)) return;
    const raceAt = prevText(i); if (raceAt < 0 || isLabel(lines[raceAt])) return;
    const driverAt = prevText(raceAt); if (driverAt < 0 || isLabel(lines[driverAt]) || TIME.test(lines[driverAt])) return;
    starts.push({ timeAt: i, raceAt, driverAt });
  });
  if (!starts.length) { out.rejected.push({ text: text.slice(0, 400), reason: 'No result post found (driver, race title, then the race time in `backticks`)', line: 1 }); return out; }

  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].driverAt : lines.length;
    const body = lines.slice(s.timeAt + 1, end);
    const driver = lines[s.driverAt], race = lines[s.raceAt];
    const timeText = TIME.exec(lines[s.timeAt])![1];
    const fields: Record<string, string> = {};
    const notes: string[] = [];
    let server = '', dateText = '', footerAt = body.length - 1;
    for (let i = 0; i < body.length; i++) {
      const l = body[i]; if (!l) continue;
      const f = FOOTER.exec(l);
      if (f && /(\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}|today|yesterday)/i.test(f[2])) {
        server = f[1].replace(/^[^\p{L}\p{N}]+/u, '').trim(); dateText = f[2].trim(); footerAt = i;
        break; // anything after the footer belongs to the chat around the post, not to it
      }
      if (isLabel(l)) {
        let v = ''; while (i + 1 < body.length && !body[i + 1]) i++;
        if (i + 1 < body.length) { v = body[++i]; }
        fields[l.toLowerCase().replace(/:$/, '')] = v.replace(/`/g, '').trim();
        continue;
      }
      notes.push(l.replace(/`/g, ''));
    }
    const line = s.driverAt + 1;
    const raw = lines.slice(s.driverAt, s.timeAt + 2 + footerAt).filter(Boolean).join('\n');
    const d = parseDuration(timeText);
    if (!d) { out.rejected.push({ text: raw, reason: `Time "${timeText}" is not a race time`, line }); return; }

    const noData = ['number', 'map', ...Object.keys(COL_METRIC)];
    const vehicle = fields.vehicle ?? '';
    if (!vehicle) noData.push('vehicle');
    const dd = dateText ? discordDate(dateText, now) : null;
    if (!dd) noData.push('date');
    const ts = dd ? parseTimestamp(dd.stamp) : null;
    const counters = emptyCounters();
    for (const m of Object.values(COL_METRIC)) counters[m] = 0;
    const dnf = notes.some((n) => /\bDNF\b|did not finish/i.test(n));
    const unknownFields: Record<string, string> = {};
    if (server) unknownFields.server = server;
    if (fields.laps) unknownFields.laps = fields.laps;
    if (fields['best lap']) unknownFields['best lap'] = fields['best lap'];
    if (fields.leaderboard) unknownFields.leaderboard = fields.leaderboard;
    if (fields.record) unknownFields['server record'] = fields.record;
    for (const [k, v] of Object.entries(fields)) if (!['vehicle', 'laps', 'best lap', 'leaderboard', 'record'].includes(k) && v) unknownFields[k] = v;
    if (notes.length) unknownFields.notes = notes.join('; ');
    noData.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    const issues = [
      `From Discord (BeamJoy Revived)${server ? `, server: ${server}` : ''}`,
      `${NO_DATA}: ${noData.join(', ')}. Manual review needed.`,
    ];
    if (notes.length) issues.push('Note: ' + notes.join('; '));
    if (dd?.relative) issues.push(`Date worked out from "${dateText}" on the day of import: check it`);
    if (dateText && !dd) issues.push(`Date "${dateText}" not understood`);
    const pr: ParsedRun = {
      raw: `${name}:\n${raw}`, fingerprint: fingerprint(['discord', driver, race, timeText, server, ts?.utcIso ?? dateText].join('|')), line,
            // BeamJoy shows the vehicle's display name ("(custom)" marks a custom config, not a model id): map it by config
      courseName: race, map: '', vehicle, modelId: null, configText: vehicle,
      timestampText: dd?.stamp ?? '', offsetMinutes: ts?.offsetMinutes ?? null, zoneName: ts?.zoneName ?? '', utcIso: ts?.utcIso ?? null, localDate: ts?.localDate ?? '',
      status: dnf ? 'DNF' : 'FINISHED', elapsedMs: d.ms, precisionMs: d.precisionMs, counters, timeOffCourseMs: null, segments: [], damage: [], truncation: [],
      unknownFields, unknownDetails: [], issues, sourceDriver: driver, sourceNumber: '', sourceRunId: '', session: '', unit: '',
      vcpsCleared: null, vcpsTotal: null, noData,
    };
    out.runs.push(pr);
  });
  return out;
}

const ORDER = ['driver', 'number', 'course', 'map', 'vehicle', 'status', 'time', 'date', ...Object.keys(COL_METRIC)];
