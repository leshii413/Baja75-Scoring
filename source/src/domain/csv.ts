// CSV in and out. Out: every cell quoted when needed, and text that a spreadsheet would run as a formula
// (starting with = + - @, tab or carriage return) is prefixed with ' so it stays text.

import { fingerprint } from './ids';
import { emptyCounters, splitVehicle, type ParsedRun, type ParseResult } from './parseLog';
import { parseDuration, parseTimestamp } from './time';
import type { Metric } from './types';

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** UTF-8 with a BOM so Excel shows accents and symbols correctly; CRLF line ends. */
export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const s = String(text).replace(/^﻿/, '');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const MANUAL_COLUMNS = ['driver', 'number', 'course', 'map', 'vehicle', 'status', 'time', 'date',
  'off_course', 'wrong_way', 'speeding', 'missed_vcps', 'jump_starts', 'resets', 'recoveries', 'damage', 'laps', 'best_lap', 'notes'] as const;

/**
 * Written in any cell when the source (e.g. a Discord result card) didn't include that value. The row still imports and
 * scores; the run is flagged for manual review. A penalty count marked this way counts as 0 (not a blocker); a time marked
 * this way can't be ranked until an official enters it.
 */
export const NO_DATA = 'No Data Provided';
export const isNoData = (v: string) => /^no\s*data\s*provided\.?$/i.test(v.trim());

export const COL_METRIC: Record<string, Metric> = {
  off_course: 'offCourse', wrong_way: 'wrongWay', speeding: 'speeding', missed_vcps: 'missedVcps',
  jump_starts: 'jumpStarts', resets: 'resets', recoveries: 'recoveries', damage: 'damageHits',
};

export function manualTemplateCsv(): string {
  return toCsv([
    [...MANUAL_COLUMNS],
    ['Example Driver', '75', 'route 20261007 082741', 'johnson_valley', 'Hirochi Aurata Race (CVT) (utv)', 'FINISHED', '4:16.8', '2026-10-07 08:38:06 UTC+08:00', 4, 4, 5, 0, 0, 0, 2, 1, '', '', ''],
    ['Example Driver', '75', 'route 20261007 082741', 'johnson_valley', 'Hirochi Aurata Race (CVT) (utv)', 'DNF', '0:09.9', '2026-10-07 08:40:00 UTC+08:00', 0, 0, 0, 0, 0, 0, 0, 0, '', '', ''],
    ['Example Discord Result', NO_DATA, 'BAJA75 Series: October 3rd Race', NO_DATA, 'SP Dunekicker (2008) (custom)', 'FINISHED', '38:32.360', '2026-10-06 13:09:00 UTC+08:00',
      NO_DATA, NO_DATA, NO_DATA, NO_DATA, NO_DATA, NO_DATA, NO_DATA, NO_DATA, 4, '6:27.173', 'From Discord: Leaderboard #1 of 4'],
  ]);
}

/** Manual / admin entries in the documented template. Blank counter cells are unknown, 0 is zero. */
export function parseManualCsv(text: string, fileName: string): ParseResult {
  const out: ParseResult = { runs: [], rejected: [], notes: ['Manual entries (CSV template).'] };
  const rows = parseCsv(text);
  if (!rows.length) { out.notes.push('Empty file.'); return out; }
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  for (const need of ['course', 'time', 'status']) if (col(need) < 0) { out.rejected.push({ text: rows[0].join(','), reason: `Missing column "${need}"`, line: 1 }); return out; }
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const raw = r.join(',');
    const noData: string[] = [];
    // a cell reading "No Data Provided" is recorded as missing and then treated as empty
    const get = (n: string) => {
      const v = col(n) >= 0 ? (r[col(n)] ?? '').trim() : '';
      if (isNoData(v)) { if (!noData.includes(n)) noData.push(n); return ''; }
      return v;
    };
    const v: Record<string, string> = {};
    for (const n of MANUAL_COLUMNS) v[n] = get(n);
    let status = v.status.toUpperCase();
    const timeText = v.time;
    const course = v.course;
    if (status === '' && noData.includes('status')) status = 'FINISHED';
    if (status !== 'FINISHED' && status !== 'DNF') { out.rejected.push({ text: raw, reason: status === 'DNS' || status === 'DSQ' ? 'DNS / DSQ are set on the race page (Results), not imported' : `Status "${v.status}" must be FINISHED or DNF (or ${NO_DATA})`, line }); return; }
    let d = parseDuration(timeText);
    if (!d && noData.includes('time')) d = { ms: 0, precisionMs: 1 };
    if (!d) { out.rejected.push({ text: raw, reason: `Time "${timeText}" is not a race time (m:ss.t), or write ${NO_DATA}`, line }); return; }
    if (!course && !noData.includes('course')) { out.rejected.push({ text: raw, reason: `No course (write the race name, or ${NO_DATA})`, line }); return; }
    const counters = emptyCounters(); const issues: string[] = ['Entered by hand (CSV)'];
    for (const [c, m] of Object.entries(COL_METRIC)) {
      const x = v[c];
      if (noData.includes(c)) { counters[m] = 0; continue; }
      if (x === '') continue;
      if (/^\d{1,9}$/.test(x)) counters[m] = Number(x); else issues.push(`${c} "${x}" is not a whole number: unknown`);
    }
    noData.sort((a, b) => MANUAL_COLUMNS.indexOf(a as never) - MANUAL_COLUMNS.indexOf(b as never));
    if (noData.length) issues.push(`${NO_DATA}: ${noData.join(', ')}. Manual review needed${noData.includes('time') ? '; enter the time before finalizing' : ''}.`);
    const unknownFields: Record<string, string> = {};
    for (const k of ['laps', 'best_lap', 'notes']) if (v[k]) unknownFields[k.replace('_', ' ')] = v[k];
    if (unknownFields.notes) issues.push('Note: ' + unknownFields.notes);
    const ts = parseTimestamp(v.date);
    const vehicle = v.vehicle; const sv = splitVehicle(vehicle);
    const pr: ParsedRun = {
      raw: `${fileName} line ${line}: ${raw}`, fingerprint: fingerprint('csv|' + raw), line,
      courseName: course || NO_DATA, map: v.map, vehicle, modelId: vehicle ? sv.modelId : null, configText: vehicle ? sv.configText : '',
      timestampText: v.date, offsetMinutes: ts?.offsetMinutes ?? null, zoneName: ts?.zoneName ?? '', utcIso: ts?.utcIso ?? null, localDate: ts?.localDate ?? '',
      status: status as 'FINISHED' | 'DNF', elapsedMs: d.ms, precisionMs: d.precisionMs, counters, timeOffCourseMs: null, segments: [], damage: [], truncation: [],
      unknownFields, unknownDetails: [], issues, sourceDriver: v.driver, sourceNumber: v.number, sourceRunId: '', session: '', unit: '',
      vcpsCleared: null, vcpsTotal: null, noData,
    };
    out.runs.push(pr);
  });
  return out;
}
