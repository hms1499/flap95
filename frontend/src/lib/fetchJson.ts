/**
 * One JSON fetch with every failure folded into a single result shape.
 *
 * Pages used to write `fetch(url).then(r => r.json()).then(setState)`, which
 * treats a 500 and an HTML error page as data and drops rejections on the
 * floor. Each of those produced the same symptom: an empty section that never
 * explains itself.
 */
export async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false };
  }
}
