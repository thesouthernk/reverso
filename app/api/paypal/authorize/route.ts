import { authorizeOrder } from "@/lib/paypal";
import { reserve } from "@/lib/store";

export async function POST(request: Request) {
  const { orderId, reqId } = await request.json().catch(() => ({}));
  if (typeof orderId !== "string" || typeof reqId !== "string") return Response.json({ error: "Missing order" }, { status: 400 });
  try {
    const a = await authorizeOrder(orderId);
    reserve(reqId, a.authorizationId, a.amount);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
