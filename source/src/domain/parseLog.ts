// Reads the Baja75 Navigation Unit's run log (settings/TreadXLGPS/race_log.txt).
// One unindented line per run (fields joined by " | ", found by their labels), then indented detail lines.

import { fingerprint, normalizeBlock } from './ids';
import { parseDuration, parseTimestamp } from './time';
import type { DamageHit, Metric, OffSegment, RejectedBlock, RunStatus } from './types';

export interface ParsedRun {
  raw: string; fingerprint: string; line: number;
  courseName: string; map: string; vehicle: string; modelId: string | null; configText: string;
  timestampText: string; offsetMinutes: number | null; zoneName: string; utcIso: string | null; localDate: string;
  status: RunStatus; elapsedMs: number; precisionMs: number;
  counters: Record<Metric, number | null>; timeOffCourseMs: number | null;
  segments: OffSegment[]; damage: DamageHit[]; truncation: string[];
  unknownFields: Record<string, string>; unknownDetails: string[]; issues: string[];
  sourceDriver: string; sourceNumber: string; sourceRunId: string; session: string; unit: string;
  vcpsCleared: number | null; vcpsTotal: number | null;
  /** manual CSV columns that said "No Data Provided" */
  noData?: string[];
}

export interface ParseResult { runs: ParsedRun[]; rejected: RejectedBlock[]; notes: string[] }

const COUNTER_LABELS: Record<string, Metric> = {
  'off course': 'offCourse', 'wrong way': 'wrongWay', 'speeding': 'speeding', 'missed vcps': 'missedVcps',
  'jump starts': 'jumpStarts', 'resets': 'resets', 'recoveries': 'recoveries', 'damage': 'damageHits',
};

export function emptyCounters(): Record<Metric, number | null> {
  return { offCourse: null, wrongWay: null, speeding: null, missedVcps: null, jumpStarts: null, resets: null, recoveries: null, damageHits: null };
}

function countValue(v: string): number | null {
  const t = v.trim();
  if (!/^\d{1,15}$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

function splitFields(line: string): string[] { return line.split(' | ').map((p) => p.trim()); }

function kv(part: string): [string, string] | null {
  const i = part.indexOf(': ');
  if (i <= 0) { const j = part.indexOf(':'); if (j > 0 && j === part.length - 1) return [part.slice(0, j).trim(), '']; return null; }
  return [part.slice(0, i).trim(), part.slice(i + 2).trim()];
}

function miles(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(\d+(?:\.\d+)?)\s*mi$/.exec(v.trim());
  return m ? Number(m[1]) : null;
}

function dur(v: string | undefined): number | null { const d = v ? parseDuration(v) : null; return d ? d.ms : null; }

/** "Hirochi Aurata Race (CVT) (utv)" -> model id "utv", config text "Hirochi Aurata Race (CVT)" */
export function splitVehicle(v: string): { modelId: string | null; configText: string } {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(v);
  if (!m || m[1] === '') return { modelId: /^[\w-]+$/.test(v.trim()) ? v.trim() : null, configText: v.trim() };
  return { modelId: m[2].trim(), configText: m[1].trim() };
}

function parseHeader(line: string, lineNo: number): { run?: ParsedRun; reject?: string } {
  const parts = splitFields(line);
  if (parts.length < 2) return { reject: 'Not a run line (no " | " fields)' };
  const issues: string[] = [];
  const ts = parseTimestamp(parts[0]);
  let rest = parts.slice(1);
  if (!ts) {
    if (kv(parts[0])) rest = parts; // no timestamp at all: the first part is a field
    issues.push('No readable date and time at the start of the line');
  }
  const counters = emptyCounters();
  const unknownFields: Record<string, string> = {};
  let course: string | null = null, map = '', vehicle = '', timeText: string | null = null, offText: string | null = null;
  let sourceDriver = '', sourceNumber = '', sourceRunId = '', session = '', unit = '', exactMs: string | null = null, vcps: string | null = null;
  for (const p of rest) {
    const f = kv(p);
    if (!f) { unknownFields[`(text ${Object.keys(unknownFields).length + 1})`] = p; continue; }
    const [k, v] = f; const key = k.toLowerCase();
    if (key === 'map') map = v;
    else if (key === 'course') course = v;
    else if (key === 'time') timeText = v;
    else if (key === 'vehicle') vehicle = v;
    else if (key === 'time off course') offText = v;
    else if (key === 'driver') sourceDriver = v;
    else if (key === 'number') sourceNumber = v;
    else if (key === 'run id') sourceRunId = v;
    else if (key === 'session') session = v;
    else if (key === 'unit') unit = v;
    else if (key === 'time ms') exactMs = v;
    else if (key === 'vcps') vcps = v;
    else if (key in COUNTER_LABELS) {
      const n = countValue(v);
      if (n === null) issues.push(`${k} is not a whole number ("${v}"): treated as unknown`);
      counters[COUNTER_LABELS[key]] = n;
    } else unknownFields[k] = v;
  }
  if (course === null || course === '') return { reject: 'No course name (Course:)' };
  if (timeText === null) return { reject: 'No time (Time:)' };
  let status: RunStatus = 'FINISHED';
  let t = timeText;
  const dnf = /^DNF(?:\s+after)?\s*(.*)$/i.exec(timeText);
  if (dnf) { status = 'DNF'; t = dnf[1]; }
  const d = parseDuration(t);
  if (!d) return { reject: `Time "${timeText}" is not a race time` };
  let elapsedMs = d.ms, precisionMs = d.precisionMs;
  if (exactMs !== null) {
    const n = countValue(exactMs);
    // the exact time is used only when it agrees with the time shown (which is cut to tenths)
    if (n !== null && Math.floor(n / d.precisionMs) === Math.floor(d.ms / d.precisionMs)) { elapsedMs = n; precisionMs = 1; }
    else issues.push(`Time ms "${exactMs}" does not match the time ${timeText}: the shown time is used`);
  }
  let timeOffCourseMs: number | null = null;
  if (offText !== null) { timeOffCourseMs = dur(offText); if (timeOffCourseMs === null) issues.push(`Time off course "${offText}" is not a duration`); }
  let vcpsCleared: number | null = null, vcpsTotal: number | null = null;
  if (vcps !== null) { const m = /^(\d+)\s*\/\s*(\d+)$/.exec(vcps); if (m) { vcpsCleared = Number(m[1]); vcpsTotal = Number(m[2]); } else unknownFields['VCPs'] = vcps; }
  const sv = splitVehicle(vehicle);
  return {
    run: {
      raw: line, fingerprint: '', line: lineNo, courseName: course, map, vehicle, modelId: sv.modelId, configText: sv.configText,
      timestampText: ts ? parts[0] : '', offsetMinutes: ts?.offsetMinutes ?? null, zoneName: ts?.zoneName ?? '', utcIso: ts?.utcIso ?? null,
      localDate: ts?.localDate ?? '', status, elapsedMs, precisionMs, counters, timeOffCourseMs, segments: [], damage: [], truncation: [],
      unknownFields, unknownDetails: [], issues, sourceDriver, sourceNumber, sourceRunId, session, unit, vcpsCleared, vcpsTotal,
    },
  };
}

function addDetail(run: ParsedRun, text: string): void {
  const t = text.trim();
  const more = /^\.\.\.\s*(\d+)\s+more\s+(.*)$/.exec(t);
  if (more) { run.truncation.push(t); return; }
  const parts = splitFields(t);
  const fields: Record<string, string> = {};
  for (const p of parts.slice(1)) { const f = kv(p); if (f) fields[f[0].toLowerCase()] = f[1]; }
  let m = /^Off course\s+(\d+)$/i.exec(parts[0]);
  if (m) {
    run.segments.push({ index: Number(m[1]), atMs: dur(fields['at']), rmMiles: miles(fields['rm']), offForMs: dur(fields['off for']),
      resets: fields['resets'] !== undefined ? countValue(fields['resets']) : null, recoveries: fields['recoveries'] !== undefined ? countValue(fields['recoveries']) : null, text: t });
    return;
  }
  m = /^Damage\s+(\d+)$/i.exec(parts[0]);
  if (m) {
    // "Parts:" can itself hold commas (and in theory " | "): everything after "Parts: " is the part list
    const pi = t.indexOf('Parts: ');
    run.damage.push({ index: Number(m[1]), atMs: dur(fields['at']), rmMiles: miles(fields['rm']), parts: pi >= 0 ? t.slice(pi + 7) : '', text: t });
    return;
  }
  run.unknownDetails.push(t);
}

function finish(run: ParsedRun, rawLines: string[]): void {
  run.raw = rawLines.join('\n');
  run.fingerprint = fingerprint(run.raw);
  // the detail durations are cut to tenths, so they may not add up to the reported total: noted, never replaced
  if (run.timeOffCourseMs !== null && run.segments.length && !run.truncation.some((x) => /off-course/i.test(x))) {
    const sum = run.segments.reduce((a, s) => a + (s.offForMs ?? 0), 0);
    if (sum !== run.timeOffCourseMs) run.issues.push(`Off-course moments add up to ${(sum / 1000).toFixed(1)} s; the run reports ${(run.timeOffCourseMs / 1000).toFixed(1)} s (times are cut to tenths). Both kept.`);
  }
  if (run.counters.offCourse !== null && run.segments.length > run.counters.offCourse) run.issues.push(`${run.segments.length} off-course moments listed but Off course says ${run.counters.offCourse}`);
  if (run.counters.damageHits !== null && run.damage.length > run.counters.damageHits) run.issues.push(`${run.damage.length} damage hits listed but Damage says ${run.counters.damageHits}`);
}

export function parseRaceLog(text: string): ParseResult {
  const src = String(text ?? '').replace(/^﻿/, '');
  const lines = src.split(/\r\n|\r|\n/);
  const runs: ParsedRun[] = [], rejected: ParseResult['rejected'] = [], notes: string[] = [];
  let cur: ParsedRun | null = null, curLines: string[] = [];
  let rejectedCur: { text: string[]; reason: string; line: number } | null = null;
  const close = () => {
    if (cur) { finish(cur, curLines); runs.push(cur); }
    if (rejectedCur) rejected.push({ text: rejectedCur.text.join('\n'), reason: rejectedCur.reason, line: rejectedCur.line });
    cur = null; curLines = []; rejectedCur = null;
  };
  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.trim() === '') return;
    if (/^\s/.test(line)) {
      if (cur) { addDetail(cur, line); curLines.push(line.replace(/\s+$/, '')); }
      else if (rejectedCur) rejectedCur.text.push(line);
      else rejected.push({ text: line, reason: 'Detail line with no run line above it (not attached to any run)', line: lineNo });
      return;
    }
    close();
    const h = parseHeader(line.replace(/\s+$/, ''), lineNo);
    if (h.run) { cur = h.run; curLines = [line.replace(/\s+$/, '')]; }
    else rejectedCur = { text: [line], reason: h.reject ?? 'Unreadable', line: lineNo };
  });
  close();
  if (!runs.length && !rejected.length) notes.push('No runs found in this text.');
  return { runs, rejected, notes };
}

export { normalizeBlock };
