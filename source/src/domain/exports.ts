// CSV exports: race results by class, the championship, and penalty breakdowns.

import { toCsv } from './csv';
import { championship, currentRevision, driverName, scoreEvent, sortResults } from './scoring';
import { formatMs } from './time';
import type { Dataset, ResultLine } from './types';

function eventLines(ds: Dataset, eventId: string): { lines: ResultLine[]; official: boolean; revision: number | null } {
  const ev = ds.events.find((e) => e.id === eventId)!;
  const rev = ev.status !== 'draft' ? currentRevision(ds, eventId) : null;
  if (rev && ev.status === 'finalized') return { lines: rev.snapshot.results, official: true, revision: rev.revision };
  return { lines: scoreEvent(ds, eventId).all, official: false, revision: null };
}

const cls = (ds: Dataset, id: string) => ds.classes.find((c) => c.id === id);
const drv = (ds: Dataset, id: string) => ds.drivers.find((d) => d.id === id);
const run = (ds: Dataset, id: string | null) => ds.runs.find((r) => r.id === id);

export function resultsCsv(ds: Dataset, eventId: string): string {
  const ev = ds.events.find((e) => e.id === eventId)!;
  const course = ds.courses.find((c) => c.id === ev.courseId);
  const { lines, official, revision } = eventLines(ds, eventId);
  const rows: unknown[][] = [['Event', 'Course', 'Map', 'Results', 'Class', 'Class rank', 'Tied', 'Overall position', 'Driver', 'Race number', 'Vehicle',
    'Status', 'Raw time', 'Raw ms', 'Penalty seconds', 'Penalty time', 'Adjusted time', 'Adjusted ms', 'Race points']];
  const ordered = [...ds.classes].sort((a, b) => a.order - b.order).flatMap((c) => sortResults(lines.filter((l) => l.classId === c.id), ds));
  for (const l of ordered) {
    rows.push([ev.name, course?.alias || course?.originalName || '', course?.map ?? '', official ? `Official (revision ${revision})` : 'Draft',
      cls(ds, l.classId)?.label ?? '', l.classRank ?? '', l.tied ? 'tie' : '', l.overallRank ?? '', driverName(ds, l.driverId), drv(ds, l.driverId)?.number ?? '',
      run(ds, l.runId)?.vehicle ?? '', l.status, l.rawMs !== null ? formatMs(l.rawMs) : '', l.rawMs ?? '', l.penaltyMs / 1000, formatMs(l.penaltyMs),
      l.adjustedMs !== null ? formatMs(l.adjustedMs) : '', l.adjustedMs ?? '', l.points]);
  }
  return toCsv(rows);
}

export function penaltiesCsv(ds: Dataset, eventId: string): string {
  const ev = ds.events.find((e) => e.id === eventId)!;
  const { lines } = eventLines(ds, eventId);
  const rows: unknown[][] = [['Event', 'Class', 'Driver', 'Race number', 'Type', 'Penalty', 'Reason', 'Counter', 'Count', 'Seconds each', 'Seconds added', 'Note']];
  for (const l of lines) for (const b of l.breakdown) {
    rows.push([ev.name, cls(ds, l.classId)?.label ?? '', driverName(ds, l.driverId), drv(ds, l.driverId)?.number ?? '', b.kind === 'auto' ? 'Automatic' : 'Manual',
      b.name, b.reason, b.metric, b.count, b.seconds, b.addedMs / 1000, b.note]);
  }
  return toCsv(rows);
}

export function championshipCsv(ds: Dataset, seasonId: string, draftPreview = false): string {
  const ch = championship(ds, seasonId, { draftPreview });
  const head = ['Class', 'Championship rank', 'Tied', 'Driver', 'Race number', ...ch.events.map((e) => e.name + (ch.draftEvents.includes(e.id) ? ' (draft)' : '')),
    'Total points', 'Scoring events', 'Wins', 'Podiums', 'Finishes'];
  const rows: unknown[][] = [head];
  for (const c of ch.classes) for (const r of c.rows) {
    rows.push([c.label, r.rank, r.tied ? 'tie' : '', driverName(ds, r.driverId), drv(ds, r.driverId)?.number ?? '',
      ...ch.events.map((e) => (e.id in r.byEvent ? r.byEvent[e.id] : '')), r.total, r.events, r.wins, r.podiums, r.finishes]);
  }
  return toCsv(rows);
}
