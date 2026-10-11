// Reads a per-course times file: settings/TreadXLGPS/times/<map>/<name>.json  { best, runs: [{ t, date, cleared, missed, total, vehicle }] }
// It holds finished runs only (no DNF), seconds, a minute-resolution local date with no time zone, VCP totals and the model id.
// It has no warnings, damage or driver: those stay unknown.

import { fingerprint } from './ids';
import { emptyCounters, splitVehicle, type ParsedRun, type ParseResult } from './parseLog';
import { secondsToMs } from './time';

export function looksLikeTimesJson(text: string): boolean {
  try { const j = JSON.parse(String(text).replace(/^﻿/, '')); return !!j && typeof j === 'object' && Array.isArray(j.runs) && !('schema' in j); } catch { return false; }
}

/** fileName "Baja_Race_1.json" -> course "Baja Race 1" (the run log shows course names with spaces) */
export function courseFromFileName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.json$/i, '').replace(/_/g, ' ').trim();
}

export function parseTimesJson(text: string, fileName: string, map = ''): ParseResult {
  const out: ParseResult = { runs: [], rejected: [], notes: [] };
  let j: unknown;
  try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) {
    out.rejected.push({ text: String(text).slice(0, 2000), reason: 'Not valid JSON', line: 1 }); return out;
  }
  const o = j as { runs?: unknown; best?: unknown };
  if (!o || typeof o !== 'object' || !Array.isArray(o.runs)) { out.rejected.push({ text: String(text).slice(0, 2000), reason: 'No "runs" list: not a times file', line: 1 }); return out; }
  const course = courseFromFileName(fileName);
  out.notes.push('Times file: finished runs only. Warnings, damage and the driver are not in this file; the date has no time zone. "best" is a summary, not another run.');
  o.runs.forEach((r: unknown, i: number) => {
    const raw = JSON.stringify(r);
    const run = r as { t?: unknown; date?: unknown; cleared?: unknown; missed?: unknown; total?: unknown; vehicle?: unknown };
    const ms = secondsToMs(run?.t);
    if (ms === null) { out.rejected.push({ text: raw, reason: 'Run has no time in seconds (t)', line: i + 1 }); return; }
    const date = typeof run.date === 'string' ? run.date : '';
    const vehicle = typeof run.vehicle === 'string' ? run.vehicle : '';
    const counters = emptyCounters();
    const int = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
    counters.missedVcps = int(run.missed);
    const sv = splitVehicle(vehicle);
    const pr: ParsedRun = {
      raw: `${fileName} #${i + 1}: ${raw}`, fingerprint: fingerprint(`times|${map}|${course}|${raw}`), line: i + 1,
      courseName: course, map, vehicle, modelId: sv.modelId, configText: sv.configText,
      timestampText: date, offsetMinutes: null, zoneName: '', utcIso: null, localDate: /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : '',
      status: 'FINISHED', elapsedMs: ms, precisionMs: 1, counters, timeOffCourseMs: null,
      segments: [], damage: [], truncation: [], unknownFields: {}, unknownDetails: [],
      issues: ['From a times file: warnings and damage unknown, date without time zone'],
      sourceDriver: '', sourceNumber: '', sourceRunId: '', session: '', unit: '',
      vcpsCleared: int(run.cleared), vcpsTotal: int(run.total),
    };
    out.runs.push(pr);
  });
  return out;
}
