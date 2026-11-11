// Caps model spend on the public demo: per visitor per hour, and per server per day.
// ponytail: in-memory counters, reset on restart; fine for one demo server.
const g = globalThis as unknown as { __limits?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__limits ??= new Map());

export function allow(request: Request, key: string, perHour: number, perDay: number): boolean {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const now = Date.now(), hour = now - 3_600_000, day = now - 86_400_000;
  const mine = (hits.get(`${key}:${ip}`) ?? []).filter((t) => t > hour);
  const all = (hits.get(key) ?? []).filter((t) => t > day);
  if (mine.length >= perHour || all.length >= perDay) return false;
  hits.set(`${key}:${ip}`, [...mine, now]); hits.set(key, [...all, now]);
  return true;
}
