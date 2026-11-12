// Who the buyer is, after Log in with PayPal. The browser holds only a random id.
// ponytail: in-memory, same process as the store.
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import type { Buyer } from "./store";

const g = globalThis as unknown as { __sessions?: Map<string, Buyer> };
const sessions = (g.__sessions ??= new Map());

export async function currentBuyer(): Promise<Buyer | null> {
  const id = (await cookies()).get("rv_sid")?.value;
  return (id && sessions.get(id)) || null;
}
// A one-time code per browser while it confirms its contact details.
// ponytail: no SMS provider is connected, so the code is returned to the page and shown as a demo code.
const pending = ((globalThis as unknown as { __codes?: Map<string, { b: Buyer; code: string; tries: number }> }).__codes ??= new Map());
export async function startVerify(b: Buyer) {
  const id = randomUUID(), code = String(Math.floor(100000 + Math.random() * 900000));
  pending.set(id, { b, code, tries: 0 });
  (await cookies()).set("rv_pending", id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return code;
}
export async function checkVerify(code: string): Promise<Buyer | null> {
  const id = (await cookies()).get("rv_pending")?.value, p = id ? pending.get(id) : undefined;
  if (!p || ++p.tries > 5) return null;
  if (p.code !== code.trim()) return null;
  pending.delete(id!); await saveBuyer({ ...p.b, verified: true }); return p.b;
}
export async function saveBuyer(b: Buyer) {
  const id = randomUUID();
  sessions.set(id, b);
  (await cookies()).set("rv_sid", id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
}
