// Presets: three Rule Sheets, three Penalty Sheets and three Class Sheets.
//
// One preset of each kind is active, and the active one IS the live setup: the points table in Settings, the default
// penalty template in Penalties and the classes + all-event vehicle mappings in Classes & Vehicles. Editing those pages
// edits the active preset. Choosing another preset first stores the live setup into the active slot, then loads the
// chosen slot into the live setup, so nothing is lost when switching back and forth.
//
// Each race event records the Rule Sheet and Penalty Sheet it uses (its penalty rules are a copy, as before, so they can
// still be adjusted for one event). Class Sheets apply to the whole app: championships are decided within a class, so
// classes don't change per event. Finalized results record the sheets they were scored with.

import { copyRulesForEvent } from './penalties';
import {
  SHEET_SLOTS, type ClassSheet, type Dataset, type EventFormat, type PenaltyRule, type PenaltySheet, type Presets, type RaceEvent,
  type RuleSheet, type SheetKind, type SheetRef, type SheetSlot,
} from './types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export const defaultSheetName = (_kind: SheetKind, slot: SheetSlot) => `Preset ${slot}`;

function liveRules(ds: Dataset): Omit<RuleSheet, 'name'> {
  const s = ds.settings[0];
  return { points: clone(s.points), nonfinishPoints: s.nonfinishPoints ?? 0, defaultFormat: s.defaultFormat ?? 'selected' };
}
function livePenalties(ds: Dataset): Omit<PenaltySheet, 'name'> {
  return { rules: clone(ds.rules.filter((r) => r.scope === 'template')) };
}
function liveClasses(ds: Dataset): Omit<ClassSheet, 'name'> {
  return { classes: clone(ds.classes), mappings: clone(ds.mappings.filter((m) => m.scope === 'global')) };
}
function live(ds: Dataset, kind: SheetKind) {
  return kind === 'rules' ? liveRules(ds) : kind === 'penalties' ? livePenalties(ds) : liveClasses(ds);
}

/** The stored presets, or (before any were set up) three copies of the current setup with Preset 1 active. */
export function presetsOf(ds: Dataset): Presets {
  const stored = ds.settings[0]?.presets;
  if (stored) return stored;
  const r = liveRules(ds), p = livePenalties(ds), c = liveClasses(ds);
  return {
    active: { rules: 1, penalties: 1, classes: 1 },
    rules: SHEET_SLOTS.map((n) => ({ name: defaultSheetName('rules', n), ...clone(r) })) as Presets['rules'],
    penalties: SHEET_SLOTS.map((n) => ({ name: defaultSheetName('penalties', n), ...clone(p) })) as Presets['penalties'],
    classes: SHEET_SLOTS.map((n) => ({ name: defaultSheetName('classes', n), ...clone(c) })) as Presets['classes'],
  };
}

function withPresets(ds: Dataset, p: Presets): Dataset {
  return { ...ds, settings: [{ ...ds.settings[0], presets: p }] };
}

export function activeSlot(ds: Dataset, kind: SheetKind): SheetSlot { return presetsOf(ds).active[kind]; }

/** A preset's content: the live setup for the active slot, the stored copy for the others. */
export function sheetOf(ds: Dataset, kind: 'rules', slot: SheetSlot): RuleSheet;
export function sheetOf(ds: Dataset, kind: 'penalties', slot: SheetSlot): PenaltySheet;
export function sheetOf(ds: Dataset, kind: 'classes', slot: SheetSlot): ClassSheet;
export function sheetOf(ds: Dataset, kind: SheetKind, slot: SheetSlot): RuleSheet | PenaltySheet | ClassSheet;
export function sheetOf(ds: Dataset, kind: SheetKind, slot: SheetSlot): RuleSheet | PenaltySheet | ClassSheet {
  const p = presetsOf(ds);
  const stored = p[kind][slot - 1];
  if (p.active[kind] === slot) return { ...live(ds, kind), name: stored.name } as RuleSheet | PenaltySheet | ClassSheet;
  return stored;
}

export function refOf(ds: Dataset, kind: SheetKind, slot: SheetSlot): SheetRef { return { slot, name: presetsOf(ds)[kind][slot - 1].name }; }
export function activeRefs(ds: Dataset): Record<SheetKind, SheetRef> {
  return { rules: refOf(ds, 'rules', activeSlot(ds, 'rules')), penalties: refOf(ds, 'penalties', activeSlot(ds, 'penalties')), classes: refOf(ds, 'classes', activeSlot(ds, 'classes')) };
}
/** "Preset 2: SCORE rules" (or just "Preset 2" when the name is the default). */
export function refLabel(r: SheetRef | null | undefined): string {
  if (!r) return 'Not recorded';
  return r.name === defaultSheetName('rules', r.slot) ? `Preset ${r.slot}` : `Preset ${r.slot}: ${r.name}`;
}

/** Classes that saved data still points to: never dropped when another Class Sheet is loaded. */
function usedClassIds(ds: Dataset): Set<string> {
  const ids = new Set<string>();
  for (const e of ds.entries) ids.add(e.classId);
  for (const r of ds.runs) if (r.classOverride) ids.add(r.classOverride);
  for (const m of ds.mappings) if (m.scope !== 'global') ids.add(m.classId);
  for (const rv of ds.revisions) for (const l of rv.snapshot.results) ids.add(l.classId);
  return ids;
}

function loadLive(ds: Dataset, kind: SheetKind, sheet: RuleSheet | PenaltySheet | ClassSheet): Dataset {
  if (kind === 'rules') {
    const r = sheet as RuleSheet;
    return { ...ds, settings: [{ ...ds.settings[0], points: clone(r.points), nonfinishPoints: r.nonfinishPoints, defaultFormat: r.defaultFormat }] };
  }
  if (kind === 'penalties') {
    const p = sheet as PenaltySheet;
    return { ...ds, rules: [...ds.rules.filter((r) => r.scope !== 'template'), ...clone(p.rules).map((r) => ({ ...r, scope: 'template' }))] };
  }
  const c = sheet as ClassSheet;
  const used = usedClassIds(ds);
  const keep = ds.classes.filter((x) => used.has(x.id) && !c.classes.some((y) => y.id === x.id));
  return { ...ds, classes: [...clone(c.classes), ...keep], mappings: [...ds.mappings.filter((m) => m.scope !== 'global'), ...clone(c.mappings).map((m) => ({ ...m, scope: 'global' }))] };
}

/** Makes another preset the active one: the live setup is stored into the current slot first. */
export function switchPreset(ds: Dataset, kind: SheetKind, slot: SheetSlot): Dataset {
  const p = clone(presetsOf(ds));
  const cur = p.active[kind];
  if (cur === slot) return withPresets(ds, p);
  (p[kind] as unknown[])[cur - 1] = { ...live(ds, kind), name: p[kind][cur - 1].name };
  const target = p[kind][slot - 1];
  p.active[kind] = slot;
  return withPresets(loadLive(ds, kind, target), p);
}

export function renamePreset(ds: Dataset, kind: SheetKind, slot: SheetSlot, name: string): Dataset {
  const p = clone(presetsOf(ds));
  p[kind][slot - 1].name = name.trim() || defaultSheetName(kind, slot);
  return withPresets(ds, p);
}

/** Overwrites a (non-active) slot with a copy of the active preset's content, keeping the slot's own name. */
export function copyActiveInto(ds: Dataset, kind: SheetKind, slot: SheetSlot): Dataset {
  const p = clone(presetsOf(ds));
  if (p.active[kind] === slot) return withPresets(ds, p);
  (p[kind] as unknown[])[slot - 1] = { ...live(ds, kind), name: p[kind][slot - 1].name };
  return withPresets(ds, p);
}

/** Saves the presets as they are now (so later edits can't change how a slot looks to an older dataset). */
export function ensurePresets(ds: Dataset): Dataset { return ds.settings[0]?.presets ? ds : withPresets(ds, presetsOf(ds)); }

// ------------------------------------------------------------------ per event

export function eventSlots(ev: RaceEvent): { rules: SheetSlot; penalties: SheetSlot } { return ev.sheets ?? { rules: 1, penalties: 1 }; }

/** The scoring rules a draft event is scored with. */
export function eventRuleSheet(ds: Dataset, ev: RaceEvent): RuleSheet { return sheetOf(ds, 'rules', eventSlots(ev).rules); }

const ruleKey = (r: PenaltyRule) => JSON.stringify([r.metric, r.name, r.reason, r.seconds, r.enabled, r.stackingConfirmed]);
/** True when the event's own penalty rules were changed after its Penalty Sheet was copied in. */
export function penaltiesChanged(ds: Dataset, ev: RaceEvent, rules = ds.rules.filter((r) => r.scope === ev.id)): boolean {
  const a = rules.map(ruleKey).sort(), b = sheetOf(ds, 'penalties', eventSlots(ev).penalties).rules.map(ruleKey).sort();
  return a.length !== b.length || a.some((x, i) => x !== b[i]);
}

export interface EventSheets { rules: SheetRef | null; penalties: SheetRef | null; penaltiesChanged: boolean; classes: SheetRef | null; frozen: boolean }

/** Which sheets an event is scored with: live for drafts, the recorded ones for finalized results. */
export function eventSheets(ds: Dataset, ev: RaceEvent): EventSheets {
  if (ev.status === 'finalized') {
    const rev = ds.revisions.filter((r) => r.eventId === ev.id && !r.superseded).sort((a, b) => b.revision - a.revision)[0];
    const s = rev?.snapshot.sheets;
    return { rules: s?.rules ?? null, penalties: s?.penalties ?? null, penaltiesChanged: !!s?.penaltiesChanged, classes: s?.classes ?? null, frozen: true };
  }
  const sl = eventSlots(ev);
  return { rules: refOf(ds, 'rules', sl.rules), penalties: refOf(ds, 'penalties', sl.penalties), penaltiesChanged: penaltiesChanged(ds, ev), classes: refOf(ds, 'classes', activeSlot(ds, 'classes')), frozen: false };
}

/** Picks the event's Rule Sheet and/or Penalty Sheet. A new Penalty Sheet replaces the event's penalty rules with a copy. */
export function setEventSheets(ds: Dataset, eventId: string, pick: { rules?: SheetSlot; penalties?: SheetSlot }): Dataset {
  const ev = ds.events.find((e) => e.id === eventId);
  if (!ev) return ds;
  const sheets = { ...eventSlots(ev), ...pick };
  let out: Dataset = { ...ds, events: ds.events.map((e) => (e.id === eventId ? { ...e, sheets } : e)) };
  if (pick.penalties !== undefined) {
    out = { ...out, rules: [...out.rules.filter((r) => r.scope !== eventId), ...copyRulesForEvent(sheetOf(ds, 'penalties', pick.penalties).rules, eventId)] };
  }
  return out;
}

export function newEventDefaults(ds: Dataset): { sheets: { rules: SheetSlot; penalties: SheetSlot }; format: EventFormat; rules: PenaltyRule[] } {
  const p = presetsOf(ds);
  return { sheets: { rules: p.active.rules, penalties: p.active.penalties }, format: ds.settings[0]?.defaultFormat ?? 'selected', rules: sheetOf(ds, 'penalties', p.active.penalties).rules };
}
