import { createOrder } from "@/lib/paypal";
import { DEPOSIT, store } from "@/lib/store";

// The amount is decided here, never by the browser.
export async function POST(request: Request) {
  const { kind, reqId } = await request.json().catch(() => ({}));
  try {
    if (kind === "topup") return Response.json(await createOrder("CAPTURE", 500, "Reverso dealer balance: pay-per-outcome contacts"));
    if (kind === "deposit") {
      const r = store().reqs.find((x) => x.id === reqId);
      if (!r?.chosen) return Response.json({ error: "Pick an offer first" }, { status: 409 });
      return Response.json(await createOrder("AUTHORIZE", DEPOSIT, `Refundable deposit to reserve ${r.model} ${r.trim} (${r.id})`));
    }
    return Response.json({ error: "Unknown order kind" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 502 });
  }
}
