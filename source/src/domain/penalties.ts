// Automatic and manual time penalties. Pure functions: the same inputs always give the same lines,
// so recalculating never adds a penalty twice.

import { METRICS, type BreakdownLine, type ManualPenalty, type Metric, type PenaltyOverride, type PenaltyRule, type Run } from './types';
import { uuid } from './ids';

export const MAX_SECONDS = 9999;

export type SecondsCheck = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Seconds per occurrence: a whole number 0..9999. Blank = unset (null), never a hidden zero.
 * Refuses negatives, fractions, 10000+, NaN / infinity, "1e3", "+5", "0x10", " 5 " with inner junk.
 */
export function checkSeconds(input: unknown): SecondsCheck {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, error: 'Must be a number' };
    if (!Number.isInteger(input)) return { ok: false, error: 'Whole seconds only' };
    if (input < 0) return { ok: false, error: 'Cannot be negative' };
    if (input > MAX_SECONDS) return { ok: false, error: `At most ${MAX_SECONDS} seconds per occurrence` };
    return { ok: true, value: input };
  }
  const t = String(input).trim();
  if (t === '') return { ok: true, value: null };
  if (/^-/.test(t)) return { ok: false, error: 'Cannot be negative' };
  if (/^\d+[.,]\d*$/.test(t) || /^[.,]\d+$/.test(t)) return { ok: false, error: 'Whole seconds only' };
  if (!/^\d+$/.test(t)) return { ok: false, error: 'Whole seconds only (digits 0-9)' };
  if (t.length > 4 || Number(t) > MAX_SECONDS) return { ok: false, error: `At most ${MAX_SECONDS} seconds per occurrence` };
  return { ok: true, value: Number(t) };
}

/** A whole count >= 0 (manual penalties, corrected counts). */
export function checkCount(input: unknown): { ok: true; value: number } | { ok: false; error: string } {
  const t = typeof input === 'number' ? String(input) : String(input ?? '').trim();
  if (!/^\d{1,9}$/.test(t)) return { ok: false, error: 'A whole number of 0 or more' };
  return { ok: true, value: Number(t) };
}

export function templateRules(): PenaltyRule[] {
  return METRICS.map((m) => ({ id: `tpl-${m.key}`, metric: m.key, name: m.rule, reason: m.reason, seconds: 0, enabled: true, scope: 'template', stackingConfirmed: false }));
}

/** An event's own rule set, copied from the template (later template edits don't change it). */
export function copyRulesForEvent(template: PenaltyRule[], eventId: string): PenaltyRule[] {
  return template.map((r) => ({ ...r, id: uuid(), scope: eventId }));
}

export interface PenaltyResult { lines: BreakdownLine[]; totalMs: number; blockers: string[]; warnings: string[] }

function mul(count: number, seconds: number): number {
  const v = count * seconds * 1000;
  if (!Number.isSafeInteger(v)) throw new RangeError('Penalty too large to add up safely');
  return v;
}

export function computePenalties(run: Run | null, rules: PenaltyRule[], overrides: PenaltyOverride[], manual: ManualPenalty[]): PenaltyResult {
  const lines: BreakdownLine[] = [], blockers: string[] = [], warnings: string[] = [];
  const enabled = rules.filter((r) => r.enabled);
  // two rules charging the same thing: only when the official has said that's intended
  const byMetric = new Map<Metric, PenaltyRule[]>();
  for (const r of enabled) byMetric.set(r.metric, [...(byMetric.get(r.metric) ?? []), r]);
  for (const [metric, rs] of byMetric) {
    if (rs.length > 1 && rs.some((r) => !r.stackingConfirmed)) blockers.push(`${rs.length} rules charge ${label(metric)}: confirm the stacking in Penalties or turn one off`);
  }
  let total = 0;
  if (run) {
    for (const r of enabled) {
      const ov = overrides.find((o) => o.runId === run.id && o.ruleId === r.id);
      const seconds = r.seconds;
      let count = run.counters[r.metric];
      let note = '';
      if (ov && ov.count !== null) { note = `Count corrected from ${count ?? 'unknown'} to ${ov.count}: ${ov.justification}`; count = ov.count; }
      if (seconds === null) { blockers.push(`"${r.name}" has no seconds set`); warnings.push(`"${r.name}" has no seconds set: counted as 0 in this draft`); }
      const sec = seconds ?? 0;
      if (count === null) {
        if (sec > 0) blockers.push(`${label(r.metric)} is unknown for this run but "${r.name}" charges it: enter the count or waive it`);
        lines.push({ kind: 'auto', name: r.name, reason: r.reason, metric: r.metric, count: 0, seconds: sec, addedMs: 0, note: 'Count unknown' + (note ? '; ' + note : '') });
        continue;
      }
      if (ov && ov.waived) {
        lines.push({ kind: 'auto', name: r.name, reason: r.reason, metric: r.metric, count, seconds: sec, addedMs: 0, note: `Waived: ${ov.justification}` });
        continue;
      }
      const added = mul(count, sec);
      total += added;
      lines.push({ kind: 'auto', name: r.name, reason: r.reason, metric: r.metric, count, seconds: sec, addedMs: added, note });
    }
  }
  for (const m of manual) {
    const added = mul(m.count, m.seconds);
    total += added;
    lines.push({ kind: 'manual', name: m.name, reason: m.reason, metric: 'manual', count: m.count, seconds: m.seconds, addedMs: added, note: '' });
  }
  if (!Number.isSafeInteger(total)) throw new RangeError('Penalty total too large');
  return { lines, totalMs: total, blockers, warnings };
}

export function label(metric: string): string { return METRICS.find((m) => m.key === metric)?.label ?? metric; }
