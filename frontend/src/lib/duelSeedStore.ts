/**
 * Where a duel's seed lives on the creator's device so they can finish an
 * interrupted run. The seed is deliberately never exposed by any API — the
 * creator holds it at creation time — so localStorage is the only place it can
 * come from on a return visit. `Storage` is injected so this is testable in node.
 */
const key = (id: number) => `flap95:duelseed:${id}`;

export function saveDuelSeed(storage: Storage, id: number, seed: number): void {
  storage.setItem(key(id), String(seed));
}

/**
 * The stored seed, or null if absent or not a finite number. A corrupt or
 * tampered value must degrade to "no seed" (recover-later message) rather than
 * crash the page or feed a NaN seed into the engine.
 */
export function loadDuelSeed(storage: Storage, id: number): number | null {
  const raw = storage.getItem(key(id));
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function clearDuelSeed(storage: Storage, id: number): void {
  storage.removeItem(key(id));
}
