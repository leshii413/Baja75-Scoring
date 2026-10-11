// Full backups: one JSON file with everything, the same on Windows and Android.

import { COLLECTIONS, SCHEMA_VERSION, type Dataset } from './types';

export const APP_NAME = 'Baja75 Scoring Management System';

export interface BackupFile { app: string; schema: number; exportedAt: string; appVersion: string; data: Dataset }

export function makeBackup(ds: Dataset, appVersion: string): BackupFile {
  return { app: APP_NAME, schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), appVersion, data: JSON.parse(JSON.stringify(ds)) };
}

export function emptyDataset(): Dataset {
  const d = {} as Dataset;
  for (const k of COLLECTIONS) (d as unknown as Record<string, unknown[]>)[k] = [];
  return d;
}

/** Checks the file before anything is changed: app, schema version, lists, ids and references. */
export function validateBackup(json: unknown): { ok: true; backup: BackupFile } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const b = json as BackupFile;
  if (!b || typeof b !== 'object') return { ok: false, errors: ['Not a backup file'] };
  if (b.app !== APP_NAME) errors.push('This file is not a Baja75 Scoring Management System backup');
  if (typeof b.schema !== 'number') errors.push('No schema version');
  else if (b.schema > SCHEMA_VERSION) errors.push(`Backup schema ${b.schema} is newer than this app (${SCHEMA_VERSION}): update the app first`);
  else if (b.schema < 1) errors.push('Unknown schema version');
  if (!b.data || typeof b.data !== 'object') return { ok: false, errors: [...errors, 'No data'] };
  for (const k of COLLECTIONS) {
    const v = (b.data as unknown as Record<string, unknown>)[k];
    if (!Array.isArray(v)) { errors.push(`"${k}" is missing or not a list`); continue; }
    const ids = new Set<string>();
    for (const x of v as { id?: unknown }[]) {
      if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id) { errors.push(`"${k}" has a record without an id`); break; }
      if (ids.has(x.id)) { errors.push(`"${k}" has the id ${x.id} twice`); break; }
      ids.add(x.id);
    }
  }
  if (errors.length) return { ok: false, errors };
  const d = b.data;
  const has = (list: { id: string }[], id: string | null) => id === null || list.some((x) => x.id === id);
  for (const e of d.events) {
    if (!has(d.seasons, e.seasonId)) errors.push(`Event "${e.name}" points to a missing season`);
    if (!has(d.courses, e.courseId)) errors.push(`Event "${e.name}" points to a missing course`);
  }
  for (const r of d.runs) {
    if (!has(d.events, r.eventId)) errors.push(`A run points to a missing event (${r.courseName})`);
    if (!has(d.drivers, r.driverId)) errors.push(`A run points to a missing driver (${r.courseName})`);
  }
  for (const e of d.entries) if (!has(d.events, e.eventId) || !has(d.drivers, e.driverId) || !has(d.classes, e.classId)) errors.push('An entry points to a missing event, driver or class');
  for (const m of d.mappings) if (!has(d.classes, m.classId)) errors.push(`Vehicle mapping "${m.matchValue}" points to a missing class`);
  for (const r of d.revisions) if (!has(d.events, r.eventId)) errors.push('A result revision points to a missing event');
  return errors.length ? { ok: false, errors: [...new Set(errors)].slice(0, 30) } : { ok: true, backup: b };
}

export interface MergePreview { added: Record<string, number>; same: number; conflicts: { collection: string; id: string; label: string }[] }

const label = (x: Record<string, unknown>) => String(x.name ?? x.label ?? x.originalName ?? x.courseName ?? x.matchValue ?? x.id);

export function previewMerge(current: Dataset, incoming: Dataset): MergePreview {
  const p: MergePreview = { added: {}, same: 0, conflicts: [] };
  for (const k of COLLECTIONS) {
    const cur = new Map((current[k] as { id: string }[]).map((x) => [x.id, x]));
    for (const x of incoming[k] as { id: string }[]) {
      const c = cur.get(x.id);
      if (!c) p.added[k] = (p.added[k] ?? 0) + 1;
      else if (JSON.stringify(c) === JSON.stringify(x)) p.same += 1;
      else if (k !== 'settings') p.conflicts.push({ collection: k, id: x.id, label: label(x as unknown as Record<string, unknown>) });
    }
  }
  return p;
}

/** Merge: new records are added; for records in both, 'keep' keeps this device's copy, 'incoming' takes the backup's. */
export function mergeDatasets(current: Dataset, incoming: Dataset, conflicts: 'keep' | 'incoming'): Dataset {
  const out = emptyDataset();
  for (const k of COLLECTIONS) {
    const map = new Map((current[k] as { id: string }[]).map((x) => [x.id, x]));
    for (const x of incoming[k] as { id: string }[]) {
      if (!map.has(x.id) || (conflicts === 'incoming' && k !== 'settings')) map.set(x.id, x);
    }
    (out as unknown as Record<string, unknown[]>)[k] = [...map.values()];
  }
  return out;
}
