// Race scoring: official result per driver and class, penalties, class ranks, race points, overall placement,
// finalized snapshots and the class championship. All pure functions over a Dataset.

import { classForRun, sortClasses } from './classes';
import { computePenalties } from './penalties';
import { eventRuleSheet, eventSheets } from './presets';
import type {
  BreakdownLine, Dataset, Entry, EntryStatus, PenaltyRule, PointsTable, RaceEvent, ResultLine, ResultRevision, Run,
} from './types';

export const DEFAULT_POINTS: PointsTable = { schedule: [30, 27, 25, 23, 21, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1], fallback: 1 };

/** Points for an eligible finisher's class position (1-based). Non-finishers get settings.nonfinishPoints (0 by default). */
export function pointsFor(rank: number, table: PointsTable = DEFAULT_POINTS): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  return rank <= table.schedule.length ? table.schedule[rank - 1] : table.fallback;
}

export function checkPointsTable(t: PointsTable): string[] {
  const errs: string[] = [];
  if (!Array.isArray(t.schedule) || !t.schedule.length) errs.push('The table needs at least one position');
  t.schedule.forEach((p, i) => { if (!Number.isSafeInteger(p) || p < 0) errs.push(`Position ${i + 1}: points must be a whole number of 0 or more`); });
  if (!Number.isSafeInteger(t.fallback) || t.fallback < 0) errs.push('Later finishers: points must be a whole number of 0 or more');
  return errs;
}

/** Competition ranking (1, 1, 3): equal values share a rank; the next rank skips. */
export function competitionRanks<T>(items: T[], value: (x: T) => number): Map<T, { rank: number; tied: boolean }> {
  const sorted = [...items].sort((a, b) => value(a) - value(b));
  const out = new Map<T, { rank: number; tied: boolean }>();
  sorted.forEach((x, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    const rank = prev !== null && value(prev) === value(x) ? out.get(prev)!.rank : i + 1;
    out.set(x, { rank, tied: false });
  });
  for (const x of sorted) {
    const v = value(x);
    if (sorted.filter((y) => value(y) === v).length > 1) out.get(x)!.tied = true;
  }
  return out;
}

/** The run's time said "No Data Provided": it can't be ranked until an official enters it. */
export const timeMissing = (r: Run | null | undefined) => !!r?.noData?.includes('time');
/** Imported with "No Data Provided" values and not yet marked reviewed (a missing time always needs review). */
export const needsReview = (r: Run | null | undefined) => !!r?.noData?.length && (!r.reviewed || timeMissing(r));

export const entryKey = (eventId: string, driverId: string, classId: string) => `${eventId}|${driverId}|${classId}`;

export function eventRules(ds: Dataset, eventId: string): PenaltyRule[] { return ds.rules.filter((r) => r.scope === eventId); }

export interface EntryResult extends ResultLine {
  entry: Entry; runs: Run[]; selectedRun: Run | null; blockers: string[]; warnings: string[]; runPenaltyMs: Map<string, number>;
}

export interface ClassGroup { classId: string; label: string; order: number; results: EntryResult[] }

export interface EventScore {
  event: RaceEvent; groups: ClassGroup[]; all: EntryResult[];
  noDriver: Run[]; noClass: { run: Run; reason: string }[]; held: Run[];
  blockers: string[]; warnings: string[];
}

function runOrder(a: Run, b: Run): number {
  return (a.utcIso ?? a.timestampText ?? '').localeCompare(b.utcIso ?? b.timestampText ?? '') || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export function scoreEvent(ds: Dataset, eventId: string, opts: { rules?: PenaltyRule[]; points?: PointsTable } = {}): EventScore {
  const event = ds.events.find((e) => e.id === eventId);
  if (!event) throw new Error('No such event');
  const sheet = eventRuleSheet(ds, event);
  const points = opts.points ?? sheet.points ?? DEFAULT_POINTS;
  const nonfinish = sheet.nonfinishPoints ?? 0;
  const rules = opts.rules ?? eventRules(ds, eventId);
  const classes = new Map(ds.classes.map((c) => [c.id, c]));
  const runs = ds.runs.filter((r) => r.eventId === eventId).sort(runOrder);
  const noDriver: Run[] = [], held: Run[] = [], noClass: { run: Run; reason: string }[] = [];
  const groups = new Map<string, Run[]>(); // entry key -> runs
  for (const r of runs) {
    if (r.held) { held.push(r); continue; }
    if (!r.driverId) { noDriver.push(r); continue; }
    const a = classForRun(r, ds.mappings);
    if (!a.classId || !classes.has(a.classId)) { noClass.push({ run: r, reason: a.conflict ?? 'No class mapping for this vehicle' }); continue; }
    const k = entryKey(eventId, r.driverId, a.classId);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  // DNS / DSQ entries can exist without runs
  for (const e of ds.entries) if (e.eventId === eventId && !groups.has(e.id) && e.statusOverride && classes.has(e.classId)) groups.set(e.id, []);

  const all: EntryResult[] = [];
  for (const [key, rs] of groups) {
    const [, driverId, classId] = key.split('|');
    const entry: Entry = ds.entries.find((e) => e.id === key) ?? { id: key, eventId, driverId, classId, selectedRunId: null, statusOverride: null, note: '' };
    const manual = ds.manualPenalties.filter((m) => m.entryId === key);
    const runPenaltyMs = new Map<string, number>();
    const pen = new Map<string, ReturnType<typeof computePenalties>>();
    for (const r of rs) {
      const p = computePenalties(r, rules, ds.overrides, manual);
      pen.set(r.id, p); runPenaltyMs.set(r.id, p.totalMs);
    }
    let selected: Run | null = null;
    const blockers: string[] = [], warnings: string[] = [];
    if (event.format === 'best') {
      const fin = rs.filter((r) => r.status === 'FINISHED' && !timeMissing(r));
      for (const r of fin) {
        if (!selected || r.elapsedMs + runPenaltyMs.get(r.id)! < selected.elapsedMs + runPenaltyMs.get(selected.id)!) selected = r;
      }
      if (!selected && rs.length) selected = rs[rs.length - 1]; // only DNFs: the latest one stands as the result
    } else {
      selected = rs.find((r) => r.id === entry.selectedRunId) ?? null;
      if (!selected && !entry.statusOverride) blockers.push('No official attempt selected');
    }
    let status: EntryStatus = entry.statusOverride ?? (selected ? selected.status : 'DNS');
    if (!selected && !entry.statusOverride && event.format === 'selected') status = 'DNS';
    const p = selected ? pen.get(selected.id)! : computePenalties(null, rules, ds.overrides, manual);
    if (selected) { blockers.push(...p.blockers); warnings.push(...p.warnings); }
    if (timeMissing(selected)) blockers.push('Time: No Data Provided. Enter the time (Change this run) before finalizing');
    if (needsReview(selected)) warnings.push(`No Data Provided (${selected!.noData!.join(', ')}): still a valid result, manual review needed`);
    const rawMs = selected && !timeMissing(selected) ? selected.elapsedMs : null;
    const finished = status === 'FINISHED' && rawMs !== null;
    const adjustedMs = finished ? rawMs! + p.totalMs : null;
    const breakdown: BreakdownLine[] = selected ? p.lines : p.lines.filter((l) => l.kind === 'manual');
    all.push({
      entryId: key, driverId, classId, runId: selected?.id ?? null, status, rawMs, penaltyMs: selected ? p.totalMs : 0, adjustedMs,
      classRank: null, overallRank: null, points: nonfinish, tied: false, breakdown, entry, runs: rs, selectedRun: selected, blockers, warnings, runPenaltyMs,
    });
  }
  // class ranks and points (adjusted time, competition ranking); overall placement across every class
  const groupsOut: ClassGroup[] = [];
  for (const c of sortClasses(ds.classes)) {
    const results = all.filter((r) => r.classId === c.id);
    if (!results.length) continue;
    const eligible = results.filter((r) => r.status === 'FINISHED' && r.adjustedMs !== null);
    const ranks = competitionRanks(eligible, (r) => r.adjustedMs!);
    for (const r of eligible) { const k = ranks.get(r)!; r.classRank = k.rank; r.tied = k.tied; r.points = pointsFor(k.rank, points); }
    for (const r of results) if (!eligible.includes(r)) { r.points = nonfinish; r.classRank = null; }
    groupsOut.push({ classId: c.id, label: c.label, order: c.order, results: sortResults(results, ds) });
  }
  const elig = all.filter((r) => r.status === 'FINISHED' && r.adjustedMs !== null);
  const ov = competitionRanks(elig, (r) => r.adjustedMs!);
  for (const r of elig) r.overallRank = ov.get(r)!.rank;

  const blockers: string[] = [], warnings: string[] = [];
  if (noDriver.length) blockers.push(`${noDriver.length} run(s) have no driver`);
  if (noClass.length) blockers.push(`${noClass.length} run(s) have no class (map their vehicles in Classes & Vehicles)`);
  if (held.length) blockers.push(`${held.length} run(s) are held for review`);
  for (const r of all) for (const b of r.blockers) blockers.push(`${driverName(ds, r.driverId)} (${classes.get(r.classId)?.label}): ${b}`);
  for (const r of rules) if (r.enabled && r.seconds === null) { /* listed per entry; also here for events with no runs */ }
  const review = all.filter((r) => needsReview(r.selectedRun)).length;
  if (review) warnings.push(`${review} result(s) have No Data Provided values: manual review needed`);
  if (!all.length) warnings.push('No scored entries yet');
  return { event, groups: groupsOut, all, noDriver, noClass, held, blockers: [...new Set(blockers)], warnings };
}

/** Rank order, then non-finishers (DNF, DSQ, DNS); tied drivers are listed by name (shown as a tie, not broken). */
export function sortResults<T extends ResultLine>(rs: T[], ds: Dataset): T[] {
  const st: Record<EntryStatus, number> = { FINISHED: 0, DNF: 1, DSQ: 2, DNS: 3 };
  return [...rs].sort((a, b) => (a.classRank ?? 1e9) - (b.classRank ?? 1e9) || st[a.status] - st[b.status] || driverName(ds, a.driverId).localeCompare(driverName(ds, b.driverId)));
}

export function driverName(ds: Dataset, id: string | null): string {
  return ds.drivers.find((d) => d.id === id)?.name ?? (id ? 'Removed driver' : 'Unassigned');
}

/** What gets frozen when an event is finalized or amended. */
export function snapshotOf(ds: Dataset, score: EventScore): ResultRevision['snapshot'] {
  const s = ds.settings[0];
  const sheet = eventRuleSheet(ds, score.event);
  const used = eventSheets(ds, { ...score.event, status: 'draft' });
  return {
    sheets: { rules: used.rules!, penalties: used.penalties!, classes: used.classes!, penaltiesChanged: used.penaltiesChanged },
    points: JSON.parse(JSON.stringify(sheet.points ?? DEFAULT_POINTS)), nonfinishPoints: sheet.nonfinishPoints ?? 0, tiePolicy: s?.tiePolicy ?? 'competition',
    format: score.event.format, rules: JSON.parse(JSON.stringify(eventRules(ds, score.event.id))),
    results: score.all.map((r) => ({
      entryId: r.entryId, driverId: r.driverId, classId: r.classId, runId: r.runId, status: r.status, rawMs: r.rawMs, penaltyMs: r.penaltyMs,
      adjustedMs: r.adjustedMs, classRank: r.classRank, overallRank: r.overallRank, points: r.points, tied: r.tied, breakdown: r.breakdown,
    })),
  };
}

export function currentRevision(ds: Dataset, eventId: string): ResultRevision | null {
  const rs = ds.revisions.filter((r) => r.eventId === eventId && !r.superseded);
  return rs.sort((a, b) => b.revision - a.revision)[0] ?? null;
}

// ------------------------------------------------------------------ championship (Overall Score)

export interface ChampRow {
  driverId: string; classId: string; byEvent: Record<string, number>; total: number; events: number; wins: number; podiums: number; finishes: number;
  rank: number; tied: boolean;
}
export interface ChampClass { classId: string; label: string; rows: ChampRow[] }
export interface Championship { events: RaceEvent[]; classes: ChampClass[]; draftEvents: string[] }

/** Official totals: finalized (or amending: its last published revision), included, not practice. Draft preview adds live draft events. */
export function championship(ds: Dataset, seasonId: string, opts: { draftPreview?: boolean } = {}): Championship {
  const events = ds.events.filter((e) => e.seasonId === seasonId && e.included && !e.practice)
    .sort((a, b) => (a.round ?? 1e9) - (b.round ?? 1e9) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const used: RaceEvent[] = [], draftEvents: string[] = [];
  const lines: { eventId: string; r: ResultLine }[] = [];
  for (const e of events) {
    const rev = e.status !== 'draft' ? currentRevision(ds, e.id) : null;
    if (rev) { used.push(e); for (const r of rev.snapshot.results) lines.push({ eventId: e.id, r }); }
    else if (opts.draftPreview) {
      const sc = scoreEvent(ds, e.id);
      used.push(e); draftEvents.push(e.id);
      for (const r of sc.all) lines.push({ eventId: e.id, r });
    }
  }
  const out: ChampClass[] = [];
  for (const c of sortClasses(ds.classes)) {
    const rows = new Map<string, ChampRow>();
    for (const { eventId, r } of lines) {
      if (r.classId !== c.id) continue;
      const row = rows.get(r.driverId) ?? { driverId: r.driverId, classId: c.id, byEvent: {}, total: 0, events: 0, wins: 0, podiums: 0, finishes: 0, rank: 0, tied: false };
      row.byEvent[eventId] = (row.byEvent[eventId] ?? 0) + r.points;
      row.total += r.points; row.events += 1;
      if (r.status === 'FINISHED') row.finishes += 1;
      if (r.classRank === 1) row.wins += 1;
      if (r.classRank !== null && r.classRank <= 3) row.podiums += 1;
      rows.set(r.driverId, row);
    }
    if (!rows.size) continue;
    const list = [...rows.values()];
    const ranks = competitionRanks(list, (x) => -x.total);
    for (const x of list) { const k = ranks.get(x)!; x.rank = k.rank; x.tied = k.tied; }
    list.sort((a, b) => a.rank - b.rank || driverName(ds, a.driverId).localeCompare(driverName(ds, b.driverId)));
    out.push({ classId: c.id, label: c.label, rows: list });
  }
  return { events: used, classes: out, draftEvents };
}
