// The dealer's finance agent: reads the account, explains the spend, and refunds unanswered
// contacts through PayPal's Agent Toolkit. Every refund must match a plan the code approved.
import { runAgent, type AppTool, type Event, type Gate } from "./agents";
import { applyRefund, dealerView, FEES, refundPlan, store } from "./store";

const STAGE = ["new contact, buyer has not answered", "visit booked", "reserved", "sold", "refunded"];

export async function askFinance(question: string) {
  const events: Event[] = [], emit = (e: Omit<Event, "at">) => events.push({ at: Date.now(), ...e });
  const planned = new Map<string, { reqId: string; amount: number }>(); // capture id -> approved refund
  const tools: AppTool[] = [
    {
      name: "get_account", description: "Bayside Motors' Reverso account: balance, fees by outcome, PayPal top-ups (capture ids) and every buyer who picked Bayside.",
      input_schema: { type: "object", properties: {} },
      run: () => {
        const v = dealerView(), s = store();
        return {
          balance: v.balance, fees: FEES, spend: v.spend,
          topups: s.topups.map((t) => ({ capture_id: t.captureId, amount: t.amount, refunded: t.refunded })),
          buyers: v.deals.map((d) => ({ request: d.reqId, name: d.name, car: d.car, stage: STAGE[d.stage], charged: d.paid, refunded: d.refunded })), // ponytail: no timestamps; the dealer's word stands in for the 48-hour clock
        };
      },
    },
    {
      name: "plan_contact_refund", description: "Check that a buyer's contact fee can be refunded (the buyer never answered). Returns the PayPal capture id and amount to pass to create_refund.",
      input_schema: { type: "object", properties: { request: { type: "string", description: "Request id, like #4821" } }, required: ["request"] },
      run: ({ request }: { request: string }) => {
        const p = refundPlan(String(request)); planned.set(p.captureId, { reqId: String(request), amount: p.amount });
        return { capture_id: p.captureId, amount: { currency_code: "USD", value: p.amount.toFixed(2) }, note_to_payer: `Reverso: buyer ${request} did not answer; contact fee returned` };
      },
    },
  ];
  const gate: Record<string, Gate> = {
    create_refund: {
      check: (i) => {
        const p = planned.get(i.capture_id);
        if (!p) return "call plan_contact_refund first; only planned contact refunds are allowed";
        if (i.amount?.currency_code !== "USD" || Number(i.amount?.value) !== p.amount) return `the refund is exactly $${p.amount} USD`;
        return null;
      },
      after: (i, res) => {
        const p = planned.get(i.capture_id)!; planned.delete(i.capture_id);
        if (res?.id) { applyRefund(p.reqId, i.capture_id, p.amount, res.id, " by your finance agent"); emit({ from: "paypal", text: `Refund ${res.id} ${String(res.status ?? "").toLowerCase()}: $${p.amount} back for ${p.reqId}.` }); }
      },
    },
    get_refund: { check: () => null },
    list_transactions: { check: () => null },
  };
  const answer = await runAgent({
    system: "You are the finance agent of Bayside Motors on Reverso, a marketplace where dealers pay only for outcomes ($40 contact, $75 total with a visit, $150 total with a reservation) from a balance funded with PayPal. " +
      "Answer the dealer's question with real numbers from get_account. A contact fee is refundable when the buyer never answered. Only the dealer knows whether a buyer answered, so when the dealer tells you a buyer never answered, act on it now without asking for confirmation: call plan_contact_refund, then PayPal's create_refund with exactly what it returned, then confirm. If the request is ambiguous, use the buyers whose stage is 'new contact'. " +
      "PayPal's transaction search can lag by hours in the sandbox; say so if it comes back empty. Reply in at most three short sentences, plain English, no markdown.",
    task: question, tools, paypal: gate, emit, maxTurns: 8,
  });
  return { answer, events };
}
