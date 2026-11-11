import { verifyByAuthorization } from "@/lib/paypal";
import { saveBuyer } from "@/lib/session";

export async function POST(request: Request) {
  const { orderId } = await request.json().catch(() => ({}));
  if (typeof orderId !== "string") return Response.json({ error: "Missing order" }, { status: 400 });
  try {
    const u = await verifyByAuthorization(orderId);
    if (!u.email) throw new Error("PayPal did not return an email");
    await saveBuyer({ ...u, verified: true });
    return Response.json({ ok: true, name: u.name, email: u.email });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
