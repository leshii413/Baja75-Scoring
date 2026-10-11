// Import review: which parsed runs will be added, which are duplicates, which are changed copies held for review.
// Duplicates are found by the run's own content within the same driver + event (a renamed file is still a duplicate;
// the same text for two different drivers is two different runs).

import { uuid } from './ids';
import type { ParsedRun } from './parseLog';
import type { Dataset, Run, RunSource } from './types';

export type RowAction = 'add' | 'duplicate' | 'revision' | 'needs-driver' | 'needs-event';

export interface PlanRow { key: string; parsed: ParsedRun; file: string; source: RunSource; driverId: string | null; eventId: string | null; action: RowAction; why: string }

export function planRows(ds: Dataset, rows: Omit<PlanRow, 'action' | 'why'>[]): PlanRow[] {
  const seen = new Set<string>();
  return rows.map((r) => {
    if (!r.driverId) return { ...r, action: 'needs-driver' as const, why: 'Pick the driver' };
    if (!r.eventId) return { ...r, action: 'needs-event' as const, why: 'Pick or create the race event' };
    const scope = `${r.driverId}|${r.eventId}|${r.parsed.fingerprint}`;
    if (seen.has(scope)) return { ...r, action: 'duplicate' as const, why: 'Same run twice in this import' };
    seen.add(scope);
    const same = ds.runs.find((x) => x.driverId === r.driverId && x.eventId === r.eventId && x.fingerprint === r.parsed.fingerprint);
    if (same) return { ...r, action: 'duplicate' as const, why: 'Already imported for this driver and event' };
    const p = r.parsed;
    const changed = ds.runs.find((x) => x.driverId === r.driverId && x.eventId === r.eventId && x.fingerprint !== p.fingerprint && (
      (p.sourceRunId !== '' && x.sourceRunId === p.sourceRunId) ||
      (p.timestampText !== '' && x.timestampText === p.timestampText && x.courseName === p.courseName && x.map === p.map)));
    if (changed) return { ...r, action: 'revision' as const, why: 'A different copy of a run already imported: held for review' };
    return { ...r, action: 'add' as const, why: '' };
  });
}

export function summarize(rows: PlanRow[]): Record<RowAction, number> {
  const s: Record<RowAction, number> = { add: 0, duplicate: 0, revision: 0, 'needs-driver': 0, 'needs-event': 0 };
  for (const r of rows) s[r.action] += 1;
  return s;
}

export function runFromParsed(p: ParsedRun, o: { batchId: string; source: RunSource; file: string; driverId: string | null; eventId: string | null; held: boolean; heldReason: string; now: string }): Run {
  return {
    id: uuid(), batchId: o.batchId, source: o.source, sourceFile: o.file, fingerprint: p.fingerprint, raw: p.raw,
    eventId: o.eventId, driverId: o.driverId, courseName: p.courseName, map: p.map, vehicle: p.vehicle, modelId: p.modelId, configText: p.configText,
    timestampText: p.timestampText, offsetMinutes: p.offsetMinutes, zoneName: p.zoneName, utcIso: p.utcIso, localDate: p.localDate,
    status: p.status, elapsedMs: p.elapsedMs, precisionMs: p.precisionMs, counters: { ...p.counters }, timeOffCourseMs: p.timeOffCourseMs,
    segments: p.segments, damage: p.damage, truncation: p.truncation, unknownFields: p.unknownFields, unknownDetails: p.unknownDetails, issues: p.issues,
    sourceDriver: p.sourceDriver, sourceNumber: p.sourceNumber, sourceRunId: p.sourceRunId, session: p.session, unit: p.unit,
    vcpsCleared: p.vcpsCleared, vcpsTotal: p.vcpsTotal, classOverride: null, held: o.held, heldReason: o.heldReason, createdAt: o.now,
    ...(p.noData?.length ? { noData: [...p.noData] } : {}),
  };
}
