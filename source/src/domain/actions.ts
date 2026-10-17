// Changes to the dataset. Each returns a new Dataset (the input is never changed) and records what changed and why.

import { emptyDataset } from './backup';
import { COL_METRIC } from './csv';
import { SEED_CLASSES } from './classes';
import { uuid } from './ids';
import { copyRulesForEvent, templateRules } from './penalties';
import { copyActiveInto, ensurePresets, eventRuleSheet, eventSlots, newEventDefaults, presetsOf, refLabel, refOf, renamePreset, setEventSheets, switchPreset } from './presets';
import { checkPointsTable, currentRevision, DEFAULT_POINTS, scoreEvent, snapshotOf } from './scoring';
import { nowIso } from './time';
import { SHEET_LABEL, type ChangeRecord, type Course, type Dataset, type Driver, type Entry, type EventFormat, type RaceEvent, type Run, type Season, type Settings, type SheetKind, type SheetSlot } from './types';

export function seedDataset(seasonName = 'Baja75 Series ' + new Date().getFullYear()): Dataset {
  const ds = emptyDataset();
  const season: Season = { id: uuid(), name: seasonName, createdAt: nowIso() };
  ds.seasons.push(season);
  ds.classes.push(...SEED_CLASSES.map((c) => ({ ...c })));
  ds.rules.push(...templateRules());
  const s: Settings = { id: 'settings', selectedSeasonId: season.id, points: JSON.parse(JSON.stringify(DEFAULT_POINTS)), nonfinishPoints: 0, tiePolicy: 'competition', championshipTie: 'shared' };
  ds.settings.push(s);
  return ensurePresets(ds);
}

function clone(ds: Dataset): Dataset { return { ...ds }; }

export function history(ds: Dataset, type: string, entity: string, entityId: string, before: unknown, after: unknown, reason = ''): Dataset {
  const rec: ChangeRecord = { id: uuid(), at: nowIso(), type, entity, entityId, before: before ?? null, after: after ?? null, reason };
  return { ...ds, history: [...ds.history, rec] };
}

export function findOrCreateCourse(ds: Dataset, originalName: string, map: string): { ds: Dataset; course: Course } {
  const c = ds.courses.find((x) => x.originalName === originalName && x.map === map);
  if (c) return { ds, course: c };
  const course: Course = { id: uuid(), originalName, map, alias: '' };
  return { ds: { ...ds, courses: [...ds.courses, course] }, course };
}

export function createEvent(ds: Dataset, o: { seasonId: string; courseId: string; name: string; round?: number | null; date?: string; format?: EventFormat }): { ds: Dataset; event: RaceEvent } {
  const event: RaceEvent = {
    id: uuid(), seasonId: o.seasonId, courseId: o.courseId, name: o.name.trim() || 'Race', round: o.round ?? null, date: o.date ?? '',
    format: o.format ?? 'selected', status: 'draft', included: true, practice: false, createdAt: nowIso(),
  };
  // a new event uses the active Rule Sheet and Penalty Sheet (its penalty rules are its own copy)
  const def = newEventDefaults(ds);
  event.sheets = def.sheets;
  if (!o.format) event.format = def.format;
  let out: Dataset = { ...ds, events: [...ds.events, event], rules: [...ds.rules, ...copyRulesForEvent(def.rules, event.id)] };
  out = history(out, 'create', 'event', event.id, null, event);
  return { ds: out, event };
}

export function createDriver(ds: Dataset, o: { name: string; number?: string; team?: string }): { ds: Dataset; driver: Driver } {
  const driver: Driver = { id: uuid(), name: o.name.trim(), number: (o.number ?? '').trim(), team: (o.team ?? '').trim(), aliases: [], createdAt: nowIso() };
  return { ds: history({ ...ds, drivers: [...ds.drivers, driver] }, 'create', 'driver', driver.id, null, driver), driver };
}

/** Possible duplicates of a new driver: same name (ignoring case) or same race number. Never merged automatically. */
export function similarDrivers(ds: Dataset, name: string, number: string): Driver[] {
  const n = name.trim().toLowerCase(), num = number.trim();
  return ds.drivers.filter((d) => (n && (d.name.toLowerCase() === n || d.aliases.some((a) => a.toLowerCase() === n))) || (num && d.number === num));
}

export function upsertEntry(ds: Dataset, entry: Entry, reason: string): Dataset {
  const before = ds.entries.find((e) => e.id === entry.id) ?? null;
  const entries = before ? ds.entries.map((e) => (e.id === entry.id ? entry : e)) : [...ds.entries, entry];
  return history({ ...ds, entries }, 'entry', 'entry', entry.id, before, entry, reason);
}

export function selectRun(ds: Dataset, entryId: string, runId: string | null, reason = 'Official attempt selected'): Dataset {
  const [eventId, driverId, classId] = entryId.split('|');
  const cur = ds.entries.find((e) => e.id === entryId) ?? { id: entryId, eventId, driverId, classId, selectedRunId: null, statusOverride: null, note: '' };
  return upsertEntry(ds, { ...cur, selectedRunId: runId }, reason);
}

export function setEntryStatus(ds: Dataset, entryId: string, status: 'DNS' | 'DSQ' | null, reason: string): Dataset {
  const [eventId, driverId, classId] = entryId.split('|');
  const cur = ds.entries.find((e) => e.id === entryId) ?? { id: entryId, eventId, driverId, classId, selectedRunId: null, statusOverride: null, note: '' };
  return upsertEntry(ds, { ...cur, statusOverride: status }, reason);
}

export type FinalizeResult = { ok: true; ds: Dataset } | { ok: false; blockers: string[] };

export function finalizeEvent(ds: Dataset, eventId: string, justification = 'Finalized'): FinalizeResult {
  const ev = ds.events.find((e) => e.id === eventId);
  if (!ev) return { ok: false, blockers: ['No such event'] };
  if (ev.status === 'finalized') return { ok: false, blockers: ['Already finalized: start an amendment to change it'] };
  const pts = checkPointsTable(eventRuleSheet(ds, ev).points ?? DEFAULT_POINTS);
  const score = scoreEvent(ds, eventId);
  const blockers = [...pts, ...score.blockers];
  if (!score.all.length) blockers.push('Nothing to finalize: no scored entries');
  if (ev.status === 'amending' && !justification.trim()) blockers.push('An amendment needs a justification');
  if (blockers.length) return { ok: false, blockers };
  const prev = currentRevision(ds, eventId);
  // numbering continues after every earlier revision (including ones set aside by Revert to draft)
  const last = ds.revisions.filter((r) => r.eventId === eventId).reduce((m, r) => Math.max(m, r.revision), 0);
  const revision = { id: uuid(), eventId, revision: last + 1, createdAt: nowIso(), justification: justification.trim(), superseded: false, snapshot: snapshotOf(ds, score) };
  const revisions = ds.revisions.map((r) => (r.eventId === eventId && !r.superseded ? { ...r, superseded: true } : r));
  const events = ds.events.map((e) => (e.id === eventId ? { ...e, status: 'finalized' as const } : e));
  const out = history({ ...ds, revisions: [...revisions, revision], events }, prev ? 'amend' : 'finalize', 'event', eventId, prev?.revision ?? null, revision.revision, justification);
  return { ok: true, ds: out };
}

/** Opens a finalized event for changes. The published revision stays official until the amendment is published. */
export function startAmendment(ds: Dataset, eventId: string, reason: string): Dataset {
  const events = ds.events.map((e) => (e.id === eventId && e.status === 'finalized' ? { ...e, status: 'amending' as const } : e));
  return history({ ...ds, events }, 'amend-start', 'event', eventId, 'finalized', 'amending', reason);
}

export function cancelAmendment(ds: Dataset, eventId: string): Dataset {
  const events = ds.events.map((e) => (e.id === eventId && e.status === 'amending' ? { ...e, status: 'finalized' as const } : e));
  return history({ ...ds, events }, 'amend-cancel', 'event', eventId, 'amending', 'finalized', '');
}

export function updateEvent(ds: Dataset, eventId: string, patch: Partial<RaceEvent>, reason = ''): Dataset {
  const before = ds.events.find((e) => e.id === eventId);
  if (!before) return ds;
  const after = { ...before, ...patch, id: before.id };
  return history({ ...ds, events: ds.events.map((e) => (e.id === eventId ? after : e)) }, 'update', 'event', eventId, before, after, reason);
}

// ------------------------------------------------------------------ overrides (protected changes and deletes)
// Each needs the person to confirm in the override prompt; each is recorded in the history as an override.

const ov = (ds: Dataset, entity: string, id: string, before: unknown, after: unknown, reason: string, what: string) =>
  history(ds, 'override:' + what, entity, id, before, after, reason);

export function renameSeason(ds: Dataset, seasonId: string, name: string, reason: string): Dataset {
  const before = ds.seasons.find((s) => s.id === seasonId);
  if (!before || !name.trim()) return ds;
  const after = { ...before, name: name.trim() };
  return ov({ ...ds, seasons: ds.seasons.map((s) => (s.id === seasonId ? after : s)) }, 'season', seasonId, before.name, after.name, reason, 'rename');
}

/** Removes an event and everything scored in it: its runs, entries, penalties, rules, event-only mappings and revisions. */
export function deleteEvent(ds: Dataset, eventId: string, reason: string): Dataset {
  const ev = ds.events.find((e) => e.id === eventId);
  if (!ev) return ds;
  const runIds = new Set(ds.runs.filter((r) => r.eventId === eventId).map((r) => r.id));
  const entryIds = new Set(ds.entries.filter((e) => e.eventId === eventId).map((e) => e.id));
  const out: Dataset = {
    ...ds,
    events: ds.events.filter((e) => e.id !== eventId),
    runs: ds.runs.filter((r) => !runIds.has(r.id)),
    entries: ds.entries.filter((e) => !entryIds.has(e.id)),
    manualPenalties: ds.manualPenalties.filter((m) => !entryIds.has(m.entryId) && !m.entryId.startsWith(eventId + '|')),
    overrides: ds.overrides.filter((o) => !runIds.has(o.runId)),
    rules: ds.rules.filter((r) => r.scope !== eventId),
    mappings: ds.mappings.filter((m) => m.scope !== eventId),
    revisions: ds.revisions.filter((r) => r.eventId !== eventId),
  };
  return ov(out, 'event', eventId, { name: ev.name, runs: runIds.size, revisions: ds.revisions.filter((r) => r.eventId === eventId).length }, null, reason, 'delete');
}

/** Removes a season with all its events. The last season can't be removed. */
export function deleteSeason(ds: Dataset, seasonId: string, reason: string): Dataset {
  const s = ds.seasons.find((x) => x.id === seasonId);
  if (!s || ds.seasons.length < 2) return ds;
  let out = ds;
  for (const e of ds.events.filter((x) => x.seasonId === seasonId)) out = deleteEvent(out, e.id, reason);
  const seasons = out.seasons.filter((x) => x.id !== seasonId);
  const settings = out.settings.map((x) => (x.selectedSeasonId === seasonId ? { ...x, selectedSeasonId: seasons[0].id } : x));
  return ov({ ...out, seasons, settings }, 'season', seasonId, s.name, null, reason, 'delete');
}

/** Removes one imported attempt. An entry that had it as the official attempt goes back to "no attempt selected". */
export function deleteRun(ds: Dataset, runId: string, reason: string): Dataset {
  const r = ds.runs.find((x) => x.id === runId);
  if (!r) return ds;
  const out: Dataset = {
    ...ds, runs: ds.runs.filter((x) => x.id !== runId), overrides: ds.overrides.filter((o) => o.runId !== runId),
    entries: ds.entries.map((e) => (e.selectedRunId === runId ? { ...e, selectedRunId: null } : e)),
  };
  return ov(out, 'run', runId, r, null, reason, 'delete');
}

/** Changes an imported attempt's time, status or warning counts. The original text stays in the run's source record. */
export function editRun(ds: Dataset, runId: string, patch: Partial<Pick<Run, 'elapsedMs' | 'status' | 'counters' | 'precisionMs'>>, reason: string): Dataset {
  const before = ds.runs.find((x) => x.id === runId);
  if (!before) return ds;
  const after: Run = { ...before, ...patch, counters: { ...before.counters, ...(patch.counters ?? {}) }, issues: [...before.issues.filter((i) => !i.startsWith('Changed by override')), `Changed by override: ${reason}`] };
  if (before.noData?.length) {
    // values typed in by an official replace the "No Data Provided" markers they cover
    const left = before.noData.filter((c) => {
      if (c === 'time') return after.elapsedMs === before.elapsedMs;
      const m = COL_METRIC[c];
      return !m || after.counters[m] === before.counters[m];
    });
    if (left.length) after.noData = left; else delete after.noData;
  }
  return ov({ ...ds, runs: ds.runs.map((x) => (x.id === runId ? after : x)) }, 'run', runId,
    { elapsedMs: before.elapsedMs, status: before.status, counters: before.counters }, { elapsedMs: after.elapsedMs, status: after.status, counters: after.counters }, reason, 'edit');
}

/** An official checked a run's "No Data Provided" values and accepts them as they are (a missing time still has to be entered). */
export function markReviewed(ds: Dataset, runId: string, reason: string): Dataset {
  const before = ds.runs.find((x) => x.id === runId);
  if (!before || !before.noData?.length) return ds;
  const after: Run = { ...before, reviewed: reason };
  return history({ ...ds, runs: ds.runs.map((x) => (x.id === runId ? after : x)) }, 'no-data-reviewed', 'run', runId, before.noData, before.noData, reason);
}

/** Takes a finalized (or amending) event back to draft: its revisions are kept but set aside, so it stops counting. */
export function revertToDraft(ds: Dataset, eventId: string, reason: string): Dataset {
  const ev = ds.events.find((e) => e.id === eventId);
  if (!ev || ev.status === 'draft') return ds;
  return ov({
    ...ds, events: ds.events.map((e) => (e.id === eventId ? { ...e, status: 'draft' as const } : e)),
    revisions: ds.revisions.map((r) => (r.eventId === eventId ? { ...r, superseded: true } : r)),
  }, 'event', eventId, ev.status, 'draft', reason, 'revert');
}

export function editDriver(ds: Dataset, driverId: string, patch: Partial<Pick<Driver, 'name' | 'number' | 'team' | 'aliases'>>, reason: string): Dataset {
  const before = ds.drivers.find((d) => d.id === driverId);
  if (!before) return ds;
  const after = { ...before, ...patch };
  // a changed name is kept as an alias so older logs still match
  if (patch.name && patch.name !== before.name && !after.aliases.includes(before.name)) after.aliases = [...after.aliases, before.name];
  return ov({ ...ds, drivers: ds.drivers.map((d) => (d.id === driverId ? after : d)) }, 'driver', driverId, before, after, reason, 'edit');
}

/**
 * Removes a driver. Their runs stay but become unassigned; their entries and manual penalties go.
 * Finalized results keep their lines (shown as a removed driver) until those events are amended or reverted.
 */
export function deleteDriver(ds: Dataset, driverId: string, reason: string): Dataset {
  const d = ds.drivers.find((x) => x.id === driverId);
  if (!d) return ds;
  const entryIds = new Set(ds.entries.filter((e) => e.driverId === driverId).map((e) => e.id));
  const out: Dataset = {
    ...ds, drivers: ds.drivers.filter((x) => x.id !== driverId),
    runs: ds.runs.map((r) => (r.driverId === driverId ? { ...r, driverId: null } : r)),
    entries: ds.entries.filter((e) => !entryIds.has(e.id)),
    manualPenalties: ds.manualPenalties.filter((m) => !entryIds.has(m.entryId) && m.entryId.split('|')[1] !== driverId),
    batches: ds.batches.map((b) => (b.driverId === driverId ? { ...b, driverId: null } : b)),
  };
  return ov(out, 'driver', driverId, d, null, reason, 'delete');
}

export { clone };

// ------------------------------------------------------------------ presets (see presets.ts)

/** Makes another preset the active Rule, Penalty or Class Sheet. Draft events using a Rule Sheet rescore; finalized results don't change. */
export function choosePreset(ds: Dataset, kind: SheetKind, slot: SheetSlot, reason: string): Dataset {
  const before = refOf(ds, kind, presetsOf(ds).active[kind]);
  if (before.slot === slot) return ds;
  const out = switchPreset(ds, kind, slot);
  return history(out, 'preset-active', 'preset', kind, refLabel(before), refLabel(refOf(out, kind, slot)), reason || `${SHEET_LABEL[kind]}: preset ${slot}`);
}

export function renamePresetAction(ds: Dataset, kind: SheetKind, slot: SheetSlot, name: string): Dataset {
  const before = refOf(ds, kind, slot).name;
  const out = renamePreset(ds, kind, slot, name);
  const after = refOf(out, kind, slot).name;
  return before === after ? ds : history(out, 'preset-rename', 'preset', `${kind}-${slot}`, before, after, '');
}

export function copyIntoPreset(ds: Dataset, kind: SheetKind, slot: SheetSlot, reason: string): Dataset {
  const from = refOf(ds, kind, presetsOf(ds).active[kind]);
  return history(copyActiveInto(ds, kind, slot), 'preset-copy', 'preset', `${kind}-${slot}`, refLabel(from), refLabel(refOf(ds, kind, slot)), reason);
}

/** Picks the Rule Sheet and/or Penalty Sheet one draft event uses. A new Penalty Sheet replaces its penalty rules. */
export function chooseEventSheets(ds: Dataset, eventId: string, pick: { rules?: SheetSlot; penalties?: SheetSlot }, reason: string): Dataset {
  const ev = ds.events.find((e) => e.id === eventId);
  if (!ev || ev.status === 'finalized') return ds;
  const before = eventSlots(ev);
  if ((pick.rules ?? before.rules) === before.rules && (pick.penalties ?? before.penalties) === before.penalties) return ds;
  return history(setEventSheets(ds, eventId, pick), 'event-sheets', 'event', eventId, before, { ...before, ...pick }, reason);
}
