import { startNegotiation, payAgentOrder } from "@/lib/deal-agent";
import { askFinance } from "@/lib/finance-agent";
import { currentBuyer } from "@/lib/session";
import { allow } from "@/lib/limit";
import { store } from "@/lib/store";

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = String(body.id ?? "");
  try {
    switch (body.action) {
      case "negotiate": {
        const buyer = await currentBuyer(), r = store().reqs.find((x) => x.id === id);
        if (!r || !buyer || buyer.email !== r.buyer.email) return Response.json({ error: "Only the verified buyer can send their agent" }, { status: 403 });
        if (!allow(request, "negotiate", 4, 80)) return Response.json({ error: "Demo limit reached. Try again in an hour." }, { status: 429 });
        startNegotiation(id, Number(body.max), !!body.reserve);
        return Response.json({ ok: true });
      }
      case "pay": {
        const buyer = await currentBuyer(), r = store().reqs.find((x) => x.id === id);
        if (!r || !buyer || buyer.email !== r.buyer.email) return Response.json({ error: "Only the verified buyer can approve" }, { status: 403 });
        await payAgentOrder(id);
        return Response.json({ ok: true });
      }
      case "finance": {
        if (!allow(request, "finance", 15, 300)) return Response.json({ error: "Demo limit reached. Try again in an hour." }, { status: 429 });
        const q = String(body.question ?? "").slice(0, 300).trim();
        if (!q) return Response.json({ error: "Ask a question" }, { status: 400 });
        return Response.json(await askFinance(q));
      }
      default: return Response.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return Response.json({ error: String((e as Error).message) }, { status: 409 });
  }
}
