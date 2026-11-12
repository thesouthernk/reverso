// The buyer's closing agent: negotiates with the dealers' agents inside the buyer's mandate,
// accepts the best real cost, and opens the reservation order through PayPal's Agent Toolkit.
import { dealerBid } from "./ai";
import { runAgent, paypalTool, type AppTool, type Gate } from "./agents";
import { choose, DEPOSIT, note, policyFor, reserve, store, ME, type Req } from "./store";

const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const MAX_COUNTERS = 3;
const label = (r: Req, id: string) => `Offer ${"ABCD"[r.offers.findIndex((o) => o.id === id)]}`;
const byLabel = (r: Req, l: string) => r.offers[Math.max(0, "ABCD".indexOf(String(l).trim().slice(-1).toUpperCase()))];

export function startNegotiation(reqId: string, max: number, reserveIt: boolean) {
  const r = store().reqs.find((x) => x.id === reqId);
  if (!r || r.status !== "open" || r.chosen || r.agent?.status === "negotiating") throw new Error("Your agent can't negotiate this request now");
  if (!Number.isFinite(max) || max < 5000) throw new Error("Enter the most you'll pay, out the door");
  r.agent = { max: Math.round(max), reserve: reserveIt, status: "negotiating", events: [], counters: 0 };
  void negotiate(r).catch((e) => { r.agent!.status = "failed"; r.agent!.events.push({ at: Date.now(), from: "gate", text: `Stopped: ${(e as Error).message}` }); });
}

async function negotiate(r: Req) {
  const a = r.agent!, emit = (e: { from: string; text: string }) => a.events.push({ at: Date.now(), ...e });
  const view = () => [...r.offers].sort((x, y) => x.realCost - y.realCost).map((o) => ({ offer: label(r, o.id), real_cost: o.realCost, headline: o.price, terms: o.perks, catch: o.note || "none" }));
  const tools: AppTool[] = [
    { name: "get_offers", description: "The sealed offers, ranked by the buyer's real cost (dealer names stay hidden).", input_schema: { type: "object", properties: {} }, run: view },
    {
      name: "counter_offer", description: `Write to one dealer's pricing agent and ask it to improve. At most ${MAX_COUNTERS} counters in total. Returns its answer and new price.`,
      input_schema: { type: "object", properties: { offer: { type: "string", description: "Offer A, B, C or D" }, message: { type: "string", description: "One or two sentences to that dealer's agent" } }, required: ["offer", "message"] },
      run: async ({ offer, message }: { offer: string; message: string }) => {
        if (a.counters >= MAX_COUNTERS) throw new Error("No counters left; decide with the offers you have");
        const o = byLabel(r, offer); if (!o) throw new Error("No such offer");
        a.counters++; emit({ from: "agent", text: `To ${label(r, o.id)}: ${message}` });
        const p = policyFor(r, o.dealerId), ranked = [...r.offers].sort((x, y) => x.realCost - y.realCost);
        const best = ranked.find((x) => x !== o) ?? o;
        const b = await dealerBid(p, { model: r.model, trim: r.trim, msrp: r.msrp, payment: r.profile.payment, when: r.profile.when, budget: r.profile.budget },
          { n: 2, myLast: o.price, position: `${ranked.indexOf(o) + 1} of ${r.offers.length}`, best: best.realCost, message });
        const price = Math.max(p.floor, Math.round(b.headline_price)), was = o.realCost;
        if (price < o.price) { o.realCost -= o.price - price; o.price = price; o.improved = true; o.reasoning = b.reasoning; } // same fine print, lower headline
        emit({ from: "dealer", text: `${label(r, o.id)}: ${o.realCost < was ? `${usd(o.realCost)} real cost, down from ${usd(was)}.` : `holds at ${usd(o.realCost)}.`} ${b.perks}` });
        if (o.dealerId === ME) note(`Request ${r.id}: the buyer's agent asked you to improve. Your agent answered ${usd(o.price)}. ${b.reasoning}`);
        return { offer: label(r, o.id), headline: o.price, real_cost: o.realCost, answer: b.perks };
      },
    },
    {
      name: "accept_offer", description: "Accept one offer for the buyer. Its dealer receives the buyer's contact; the others never learn who they are. Only allowed within the buyer's mandate.",
      input_schema: { type: "object", properties: { offer: { type: "string" } }, required: ["offer"] },
      run: ({ offer }: { offer: string }) => {
        const o = byLabel(r, offer); if (!o) throw new Error("No such offer");
        if (o.realCost > a.max) { emit({ from: "gate", text: `Blocked: ${label(r, o.id)} costs ${usd(o.realCost)}, over the buyer's ${usd(a.max)}` }); throw new Error(`Over the buyer's mandate of ${usd(a.max)}`); }
        choose(r.id, o.id); emit({ from: "agent", text: `Accepted ${label(r, o.id)} at ${usd(o.realCost)} out the door.` });
        return { accepted: label(r, o.id), real_cost: o.realCost, reserve: a.reserve, deposit: DEPOSIT };
      },
    },
  ];
  // The only PayPal call this agent may make: one $500 deposit order, after it accepted an offer, if the buyer asked for it.
  const gate: Record<string, Gate> = {
    create_order: {
      check: (i) => {
        const total = (i.items ?? []).reduce((s: number, it: { itemTotal?: number; itemCost?: number; quantity?: number }) => s + (it.itemTotal ?? (it.itemCost ?? 0) * (it.quantity ?? 1)), 0) + (i.shippingCost ?? 0) - (i.discount ?? 0);
        if (!r.chosen) return "accept an offer first";
        if (!a.reserve) return "the buyer did not ask you to reserve";
        if (a.order) return "the reservation order already exists";
        if (Math.abs(total - DEPOSIT) > 0.001) return `the deposit is exactly ${usd(DEPOSIT)}, not ${usd(total)}`;
        return null;
      },
      after: (_i, res) => { const id = res?.id ?? res?.orderId; if (id) { a.order = id; emit({ from: "paypal", text: `Order ${id} created for the ${usd(DEPOSIT)} refundable deposit. Waiting for the buyer to approve it in PayPal.` }); } },
    },
  };
  const final = await runAgent({
    system: `You are Reverso, the buyer's agent for a new ${r.model} ${r.trim}. The buyer, ${r.buyer.name.split(" ")[0]}, gave you a mandate: get the lowest real out-the-door cost, never above ${usd(a.max)}, then ${a.reserve ? `reserve it with a ${usd(DEPOSIT)} refundable PayPal deposit` : "stop; the buyer will decide how to reserve"}. ` +
      `They pay with: ${r.profile.payment}. They can wait: ${r.profile.wait}. Negotiate like a sharp, polite buyer's agent: use the competing offers as leverage, name concrete numbers, mention stock and timing. You have at most ${MAX_COUNTERS} counters; do not waste them on offers far behind. ` +
      `Then accept the best real cost within the mandate. ${a.reserve ? `After accepting, create the PayPal order with the create_order tool: one item named "Refundable deposit, ${r.model} ${r.trim} (${r.id})", itemCost ${DEPOSIT}, itemTotal ${DEPOSIT}, quantity 1, USD. Never capture it: the buyer approves it in PayPal.` : ""} ` +
      `If nothing fits the mandate, accept nothing and say so. Finish with at most three short sentences to the buyer: what you got, how much you saved, and any trade-off. Plain text only: no markdown, no links, no order ids; the app shows the PayPal button.`,
    task: "Start with get_offers.",
    tools, paypal: gate, emit, maxTurns: 12,
  });
  a.status = a.order ? "awaiting-approval" : "done";
  if (!a.events.length || a.events[a.events.length - 1].text !== final) emit({ from: "agent", text: final });
}

/** The buyer approved the agent's order in PayPal: capture it through the Agent Toolkit and record the reservation. */
export async function payAgentOrder(reqId: string) {
  const r = store().reqs.find((x) => x.id === reqId), a = r?.agent;
  if (!r || !a?.order || r.reservation) throw new Error("There is no deposit waiting for approval");
  const captureOf = (o: any) => (o?.response ?? o)?.purchase_units?.[0]?.payments?.captures?.[0]; // pay_order wraps the order in { status, response }
  let cap = captureOf(await paypalTool("pay_order", { id: a.order }).catch(() => null));
  if (cap?.status !== "COMPLETED") cap = captureOf(await paypalTool("get_order", { id: a.order })); // already captured on a retry
  if (!cap || cap.status !== "COMPLETED") throw new Error(`PayPal did not complete the capture (${cap?.status ?? "no capture"})`);
  reserve(r.id, cap.id, Number(cap.amount?.value ?? DEPOSIT), true);
  a.status = "done"; a.events.push({ at: Date.now(), from: "paypal", text: `Captured ${usd(Number(cap.amount?.value ?? DEPOSIT))} (capture ${cap.id}). The car is reserved; the deposit is refundable until you sign.` });
}
