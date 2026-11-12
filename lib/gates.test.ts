// The payment gates: the model is replaced by a script that tries good and bad PayPal calls.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppTool, Gate } from "./agents";

vi.mock("./ai", async () => {
  const real = await vi.importActual<typeof import("./ai")>("./ai");
  return {
    CATALOG: real.CATALOG,
    dealerBid: vi.fn(async (p: { floor: number }) => ({ headline_price: p.floor + 300, perks: "ok", fine_print: "", reasoning: "fake" })),
    reviewOffers: vi.fn(async (_p: string, offers: { id: string; headline_price: number }[]) => ({ offers: offers.map((o) => ({ id: o.id, real_cost: o.headline_price, applies: true, note: "" })), summary: "" })),
  };
});
vi.mock("./paypal", () => ({ refundCapture: vi.fn() }));
// The "model": each test sets what it does with the tools and gates it is handed.
let script: (t: { tools: AppTool[]; paypal: Record<string, Gate> }) => Promise<void> = async () => {};
vi.mock("./agents", () => ({
  runAgent: vi.fn(async (o: { tools: AppTool[]; paypal: Record<string, Gate> }) => { await script(o); return "done"; }),
  paypalTool: vi.fn(),
}));

import * as S from "./store";
import { startNegotiation } from "./deal-agent";
import { askFinance } from "./finance-agent";

const profile = { city: "Austin, TX", travel: "Up to 25 miles", wait: "Up to 4 weeks", budget: "Up to $40,000", payment: "Cash", when: "This week" };
async function open() {
  S.addTopUp("CAPTUREAAAAAAAAAA1", 500);
  const r = S.createRequest("Terra Hybrid", "Touring", profile, { name: "Maria", email: "m@example.com", phone: "1", verified: true });
  for (let i = 0; i < 50 && r.status !== "open"; i++) await new Promise((x) => setTimeout(x, 5));
  return r;
}
const tool = (tools: AppTool[], name: string) => tools.find((t) => t.name === name)!;
const settle = async (r: S.Req) => { for (let i = 0; i < 50 && r.agent?.status === "negotiating"; i++) await new Promise((x) => setTimeout(x, 5)); };
const deposit = (total: number) => ({ currencyCode: "USD", items: [{ name: "Deposit", quantity: 1, itemCost: total, itemTotal: total }] });

beforeEach(() => { delete (globalThis as { __reverso?: unknown }).__reverso; });

describe("closing agent gate", () => {
  it("refuses an offer over the mandate and any order before accepting", async () => {
    const r = await open(), best = Math.min(...r.offers.map((o) => o.realCost));
    const seen: (string | null)[] = [];
    script = async ({ tools, paypal }) => {
      seen.push(paypal.create_order.check(deposit(500)));                       // nothing accepted yet
      await expect(tool(tools, "accept_offer").run({ offer: "Offer A" })).rejects.toThrow(/mandate/);
    };
    startNegotiation(r.id, best - 1, true); await settle(r);
    expect(seen[0]).toMatch(/accept an offer first/);
    expect(r.chosen).toBeUndefined();
  });

  it("allows exactly one $500 deposit order after a valid accept", async () => {
    const r = await open(), cheapest = [...r.offers].sort((a, b) => a.realCost - b.realCost)[0];
    const label = `Offer ${"ABCD"[r.offers.indexOf(cheapest)]}`, seen: (string | null)[] = [];
    script = async ({ tools, paypal }) => {
      await tool(tools, "accept_offer").run({ offer: label });
      seen.push(paypal.create_order.check(deposit(5000)));                      // wrong amount
      seen.push(paypal.create_order.check(deposit(500)));                       // right amount
      paypal.create_order.after!(deposit(500), { id: "ORDER1234567890ABC" });
      seen.push(paypal.create_order.check(deposit(500)));                       // a second order
    };
    startNegotiation(r.id, cheapest.realCost, true); await settle(r);
    expect(seen[0]).toMatch(/exactly \$500/);
    expect(seen[1]).toBeNull();
    expect(seen[2]).toMatch(/already exists/);
    expect(r.chosen).toBe(cheapest.id);
    expect(r.agent).toMatchObject({ status: "awaiting-approval", order: "ORDER1234567890ABC" });
  });
});

describe("finance agent gate", () => {
  it("refunds only the planned capture and amount, then records it", async () => {
    const r = await open();
    S.choose(r.id, S.ME);
    const seen: (string | null)[] = [];
    script = async ({ tools, paypal }) => {
      const g = paypal.create_refund;
      seen.push(g.check({ capture_id: "CAPTUREAAAAAAAAAA1", amount: { currency_code: "USD", value: "40.00" } })); // not planned
      const plan = await tool(tools, "plan_contact_refund").run({ request: r.id }) as { capture_id: string };
      seen.push(g.check({ capture_id: plan.capture_id, amount: { currency_code: "USD", value: "500.00" } }));     // too much
      const ok = { capture_id: plan.capture_id, amount: { currency_code: "USD", value: "40.00" } };
      seen.push(g.check(ok));
      g.after!(ok, { id: "REFUND1234567890A", status: "COMPLETED" });
    };
    await askFinance("Maria never answered. Refund the contact fee.");
    expect(seen[0]).toMatch(/plan_contact_refund first/);
    expect(seen[1]).toMatch(/exactly \$40/);
    expect(seen[2]).toBeNull();
    expect(S.store().deals[0]).toMatchObject({ stage: 4, refunded: 40 });
    expect(S.dealerView().spend.refunded).toBe(40);
  });

  it("won't plan a refund for a buyer who already reserved", async () => {
    const r = await open();
    S.choose(r.id, S.ME); S.reserve(r.id, "AUTH", 500);
    let err = "";
    script = async ({ tools }) => { try { await tool(tools, "plan_contact_refund").run({ request: r.id }); } catch (e) { err = (e as Error).message; } };
    await askFinance("Refund Maria.");
    expect(err).toMatch(/unanswered/);
  });
});
