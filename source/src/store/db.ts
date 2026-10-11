// IndexedDB storage: one object store per collection. Every commit is one transaction: it all saves, or nothing does.

import { openDB, type IDBPDatabase } from 'idb';
import { seedDataset } from '../domain/actions';
import { emptyDataset } from '../domain/backup';
import { COLLECTIONS, SCHEMA_VERSION, type Dataset } from '../domain/types';

const DB_NAME = 'baja75-scoring';
let dbp: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, SCHEMA_VERSION, {
      upgrade(d) {
        for (const k of COLLECTIONS) if (!d.objectStoreNames.contains(k)) d.createObjectStore(k, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
      },
    });
  }
  return dbp;
}

export async function loadAll(): Promise<{ ds: Dataset; fresh: boolean }> {
  const d = await db();
  const ds = emptyDataset();
  const tx = d.transaction([...COLLECTIONS], 'readonly');
  for (const k of COLLECTIONS) (ds as unknown as Record<string, unknown[]>)[k] = await tx.objectStore(k).getAll();
  await tx.done;
  if (!ds.settings.length && !ds.classes.length) {
    const seeded = seedDataset();
    await replaceAll(seeded);
    return { ds: seeded, fresh: true };
  }
  return { ds, fresh: false };
}

/** Writes what changed between two datasets (records are replaced, never edited in place, so a changed record is a new object). */
export async function saveDiff(prev: Dataset, next: Dataset): Promise<number> {
  const d = await db();
  const tx = d.transaction([...COLLECTIONS], 'readwrite');
  let n = 0;
  const ops: Promise<unknown>[] = [];
  for (const k of COLLECTIONS) {
    const a = prev[k] as { id: string }[], b = next[k] as { id: string }[];
    if (a === b) continue;
    const old = new Map(a.map((x) => [x.id, x]));
    const store = tx.objectStore(k);
    for (const x of b) { if (old.get(x.id) !== x) { ops.push(store.put(x)); n++; } old.delete(x.id); }
    for (const id of old.keys()) { ops.push(store.delete(id)); n++; }
  }
  await Promise.all([...ops, tx.done]);
  return n;
}

export async function replaceAll(ds: Dataset): Promise<void> {
  const d = await db();
  const tx = d.transaction([...COLLECTIONS], 'readwrite');
  const ops: Promise<unknown>[] = [];
  for (const k of COLLECTIONS) {
    const store = tx.objectStore(k);
    ops.push(store.clear());
    for (const x of ds[k] as object[]) ops.push(store.put(x));
  }
  await Promise.all([...ops, tx.done]);
}

export async function storageStatus(): Promise<{ persisted: boolean | null; usage: number | null; quota: number | null }> {
  const s = (navigator as Navigator & { storage?: StorageManager }).storage;
  if (!s) return { persisted: null, usage: null, quota: null };
  let persisted: boolean | null = null;
  try { persisted = await s.persisted(); } catch { /* not supported */ }
  try { const e = await s.estimate(); return { persisted, usage: e.usage ?? null, quota: e.quota ?? null }; } catch { return { persisted, usage: null, quota: null }; }
}

export async function askPersistent(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export { emptyDataset };
