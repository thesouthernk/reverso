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
export async function saveBuyer(b: Buyer) {
  const id = randomUUID();
  sessions.set(id, b);
  (await cookies()).set("rv_sid", id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
}
