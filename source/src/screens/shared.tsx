import type { Dataset } from '../domain/types';

export function courseLabel(ds: Dataset, courseId: string): string {
  const c = ds.courses.find((x) => x.id === courseId);
  if (!c) return 'Unknown course';
  return c.alias ? `${c.alias} (${c.originalName})` : c.originalName;
}
export function className(ds: Dataset, id: string | null): string { return ds.classes.find((c) => c.id === id)?.label ?? 'Unassigned'; }
export function driverLabel(ds: Dataset, id: string | null): string {
  const d = ds.drivers.find((x) => x.id === id);
  return d ? d.name + (d.number ? ` #${d.number}` : '') : id ? 'Removed driver' : 'Unassigned';
}
export function sortedDrivers(ds: Dataset) { return [...ds.drivers].sort((a, b) => a.name.localeCompare(b.name)); }
export function seasonEvents(ds: Dataset, seasonId: string) {
  return ds.events.filter((e) => e.seasonId === seasonId).sort((a, b) => (a.round ?? 1e9) - (b.round ?? 1e9) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}
