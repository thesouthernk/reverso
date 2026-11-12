import { bookVisit, buyerView, choose, confirmPurchase, createRequest, dealerView, GAS_CARD, rebid, refundNoAnswer, setFloor, store } from "@/lib/store";
import { currentBuyer } from "@/lib/session";
import { clientId, payout } from "@/lib/paypal";
import { allow } from "@/lib/limit";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  if (q.get("as") === "buyer") {
    const view = buyerView(q.get("id") ?? "");
    return view ? Response.json(view) : Response.json({ error: "Request not found" }, { status: 404 });
  }
  if (q.get("as") === "me") return Response.json({ buyer: await currentBuyer(), clientId: clientId() });
  return Response.json({ ...dealerView(), clientId: clientId() });
}

const str = (v: unknown, n = 80) => String(v ?? "").slice(0, n);

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.action) {
      case "request": {
        const buyer = await currentBuyer();
        if (!buyer) return Response.json({ error: "Verify with PayPal first" }, { status: 401 });
        if (!allow(request, "auction", 6, 120)) return Response.json({ error: "Demo limit reached. Try again in an hour." }, { status: 429 });
        const p = body.profile ?? {};
        const r = createRequest(str(body.model), str(body.trim), { city: str(p.city), travel: str(p.travel), wait: str(p.wait), budget: str(p.budget), payment: str(p.payment), when: str(p.when) }, buyer);
        return Response.json({ id: r.id });
      }
      case "choose": choose(str(body.id), str(body.offer)); return Response.json({ ok: true });
      case "visit": bookVisit(str(body.id), str(body.slot, 40)); return Response.json({ ok: true });
      case "confirm": {
        const r = store().reqs.find((x) => x.id === str(body.id));
        const buyer = await currentBuyer();
        if (!r || !buyer || buyer.email !== r.buyer.email) return Response.json({ error: "Only the verified buyer can confirm" }, { status: 403 });
        const p = await payout(buyer.email, GAS_CARD, `Thanks for confirming your ${r.model} purchase. Here is your gas card.`, `gas-${r.id.slice(1)}-${Date.now()}`);
        confirmPurchase(r.id, p.batchId);
        return Response.json({ ok: true, batch: p.batchId });
      }
      case "rebid": {
        if (!allow(request, "rebid", 12, 200)) return Response.json({ error: "Demo limit reached. Try again in an hour." }, { status: 429 });
        const id = str(body.id), floor = Number(body.floor);
        if (!store().reqs.some((r) => r.id === id && r.status === "open" && !r.chosen)) return Response.json({ error: "This request can't be re-bid now" }, { status: 409 });
        void rebid(id, floor).catch(() => {}); // runs in the background; the grid shows "Re-bidding", then the new bid flashes in
        return Response.json({ ok: true });
      }
      case "floor": return Response.json({ ok: setFloor(str(body.key), Number(body.floor)) });
      case "noanswer": { const r = await refundNoAnswer(str(body.id)); return Response.json({ ok: true, refund: r.id }); }
      default: return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 409 });
  }
}
