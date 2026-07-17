export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random unit value derived purely from (seed, index) — safe to query in any order. */
export function hashedUnit(seed: number, index: number): number {
  return mulberry32((seed ^ Math.imul(index + 1, 2654435761)) >>> 0)();
}
