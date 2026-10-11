// Baja75 classes and the vehicle-to-class mapping. A class is never guessed from a vehicle's name or type:
// only an explicit mapping (or a manual assignment) puts a run in a class.

import type { ClassDef, Run, VehicleMapping } from './types';

export const SEED_CLASSES: ClassDef[] = [
  'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 5U', 'Class 6', 'Class 7',
  'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 15', 'Class 18',
].map((label, i) => ({ id: 'c-' + label.slice(6).toLowerCase(), label, order: i + 1 }));

export function sortClasses(cs: ClassDef[]): ClassDef[] { return [...cs].sort((a, b) => a.order - b.order); }

export interface ClassAssignment { classId: string | null; how: 'manual' | 'event-config' | 'event-model' | 'global-config' | 'global-model' | 'none' | 'conflict'; conflict: string | null }

/**
 * Precedence: manual assignment on the run > event configuration > event model > template configuration > template model.
 * Two different classes at the same level = a conflict (left unassigned until resolved).
 */
export function classForRun(run: Pick<Run, 'configText' | 'vehicle' | 'modelId' | 'classOverride' | 'eventId'>, mappings: VehicleMapping[]): ClassAssignment {
  if (run.classOverride) return { classId: run.classOverride, how: 'manual', conflict: null };
  const levels: [ClassAssignment['how'], (m: VehicleMapping) => boolean][] = [
    ['event-config', (m) => m.scope === run.eventId && m.matchType === 'config' && configMatches(m.matchValue, run)],
    ['event-model', (m) => m.scope === run.eventId && m.matchType === 'model' && !!run.modelId && m.matchValue === run.modelId],
    ['global-config', (m) => m.scope === 'global' && m.matchType === 'config' && configMatches(m.matchValue, run)],
    ['global-model', (m) => m.scope === 'global' && m.matchType === 'model' && !!run.modelId && m.matchValue === run.modelId],
  ];
  for (const [how, test] of levels) {
    const hits = mappings.filter(test);
    if (!hits.length) continue;
    const ids = [...new Set(hits.map((h) => h.classId))];
    if (ids.length > 1) return { classId: null, how: 'conflict', conflict: `${hits.length} mappings at the same level point to different classes` };
    return { classId: ids[0], how, conflict: null };
  }
  return { classId: null, how: 'none', conflict: null };
}

/** An exact configuration match: the full vehicle text as shown, or the configuration text without the model id. */
function configMatches(value: string, run: Pick<Run, 'configText' | 'vehicle'>): boolean {
  return value === run.vehicle || value === run.configText;
}

/** Mappings that disagree with each other (same match, different class, same scope). */
export function mappingConflicts(mappings: VehicleMapping[]): { key: string; mappings: VehicleMapping[] }[] {
  const groups = new Map<string, VehicleMapping[]>();
  for (const m of mappings) {
    const k = `${m.scope}|${m.matchType}|${m.matchValue}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  return [...groups.entries()].filter(([, ms]) => new Set(ms.map((m) => m.classId)).size > 1).map(([key, ms]) => ({ key, mappings: ms }));
}
