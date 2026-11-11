import { captureOrder } from "@/lib/paypal";
import { addTopUp } from "@/lib/store";

export async function POST(request: Request) {
  const { orderId } = await request.json().catch(() => ({}));
  if (typeof orderId !== "string") return Response.json({ error: "Missing order" }, { status: 400 });
  try {
    const c = await captureOrder(orderId);
    addTopUp(c.captureId, c.amount);
    return Response.json({ ok: true, amount: c.amount });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
