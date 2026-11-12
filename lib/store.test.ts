// The marketplace rules, with Claude and PayPal replaced by fakes: no network, no cost.
import { beforeEach, describe, expect, it, vi } from "vitest";

const bids: Record<string, number> = {}; // dealer id -> headline price the fake agent asks for
vi.mock("./ai", async () => {
  const real = await vi.importActual<typeof import("./ai")>("./ai");
  return {
    CATALOG: real.CATALOG,
    dealerBid: vi.fn(async (p: { id: string; floor: number }) => ({
      headline_price: bids[p.id] ?? p.floor + 300, perks: "", fine_print: "", reasoning: `fake ${p.id}`,
    })),
    reviewOffers: vi.fn(async (_pay: string, offers: { id: string; headline_price: number }[]) => ({
      offers: offers.map((o) => ({ id: o.id, real_cost: o.headline_price, applies: true, note: "" })), summary: "fake",
    })),
  };
});
vi.mock("./paypal", () => ({ refundCapture: vi.fn(async () => ({ id: "REFUND-1", status: "COMPLETED" })) }));

import * as S from "./store";
import { refundCapture } from "./paypal";

const profile = { city: "Austin, TX", travel: "Up to 25 miles", wait: "Up to 4 weeks", budget: "Up to $40,000", payment: "Cash", when: "This week" };
const buyer = { name: "Maria", email: "m@example.com", phone: "1", verified: true };
async function open(p = profile) {
  const r = S.createRequest("Terra Hybrid", "Touring", p, buyer);
  for (let i = 0; i < 50 && r.status !== "open"; i++) await new Promise((x) => setTimeout(x, 5));
  expect(r.status).toBe("open");
  return r;
}
const rankOf = (r: S.Req, dealerId: string) => [...r.offers].sort((a, b) => a.realCost - b.realCost).findIndex((o) => o.dealerId === dealerId) + 1;

beforeEach(() => {
  delete (globalThis as { __reverso?: unknown }).__reverso;
  for (const k of Object.keys(bids)) delete bids[k];
  vi.mocked(refundCapture).mockClear();
});

describe("auction", () => {
  it("never lets an agent bid under its floor", async () => {
    S.addTopUp("CAP-1", 500);
    bids.bayside = 1000; // the agent tries to dump the price
    const r = await open();
    const mine = r.offers.find((o) => o.dealerId === S.ME)!;
    expect(mine.price).toBe(r.myFloor);
  });

  it("Bayside sits out without enough balance; the volume dealer sits out when the buyer needs the car now", async () => {
    const r = await open({ ...profile, wait: "I need it on the lot now" });
    expect(r.offers.map((o) => o.dealerId).sort()).toEqual(["northgate", "summit"]);
  });

  it("buyers never see dealer names until they choose", async () => {
    S.addTopUp("CAP-1", 500);
    const r = await open();
    expect(S.buyerView(r.id)!.offers.every((o) => o.dealer === null)).toBe(true);
    S.choose(r.id, r.offers[0].id);
    expect(S.buyerView(r.id)!.offers.find((o) => o.id === r.offers[0].id)!.dealer).not.toBeNull();
  });
});

describe("pay per outcome", () => {
  it("charges $40, then $75 total, then $150 total, from the PayPal-funded balance", async () => {
    S.addTopUp("CAP-1", 500);
    bids.lakeshore = 99_000; bids.summit = 99_000; bids.northgate = 99_000; // Bayside wins
    const r = await open();
    S.choose(r.id, S.ME);
    expect(S.store().balance).toBe(460);
    S.bookVisit(r.id, "Tomorrow, 10:00 am");
    expect(S.store().balance).toBe(425);
    S.reserve(r.id, "AUTH-1", 500);
    expect(S.store().balance).toBe(350);
    expect(S.store().deals[0]).toMatchObject({ paid: 150, stage: 2 });
    expect(S.dealerView().spend).toEqual({ contact: 40, visit: 35, reserve: 75, refunded: 0 });
  });

  it("charges nothing when the buyer picks another dealer", async () => {
    S.addTopUp("CAP-1", 500);
    const r = await open();
    S.choose(r.id, r.offers.find((o) => o.dealerId !== S.ME)!.id);
    expect(S.store().balance).toBe(500);
    expect(S.store().deals).toHaveLength(0);
  });

  it("refunds the contact fee through PayPal once, and only for an unanswered contact", async () => {
    S.addTopUp("CAP-1", 500);
    bids.lakeshore = 99_000; bids.summit = 99_000; bids.northgate = 99_000;
    const r = await open();
    S.choose(r.id, S.ME);
    await S.refundNoAnswer(r.id);
    expect(refundCapture).toHaveBeenCalledWith("CAP-1", 40, expect.any(String), `refund-${r.id}`);
    expect(S.store().deals[0]).toMatchObject({ refunded: 40, stage: 4 });
    expect(S.dealerView().spend.refunded).toBe(40);
    await expect(S.refundNoAnswer(r.id)).rejects.toThrow();
  });
});

describe("live re-bid from the dealer grid", () => {
  it("a lower floor lets the agent take the lead, and the dealer grid shows it", async () => {
    S.addTopUp("CAP-1", 500);
    bids.lakeshore = 37_400; bids.summit = 99_000; bids.northgate = 99_000; // the volume dealer leads at first
    const r = await open();
    expect(rankOf(r, S.ME)).toBe(2);
    expect(S.dealerView().rows[0].toLead).toBe(37_399);
    bids.bayside = 37_100;
    await S.rebid(r.id, 37_000);
    expect(rankOf(r, S.ME)).toBe(1);
    expect(S.dealerView().rows[0]).toMatchObject({ myFloor: 37_000, myPrice: 37_100, rank: 1, aheadBy: 300, status: "Bidding" });
  });

  it("is refused once the buyer has chosen", async () => {
    S.addTopUp("CAP-1", 500);
    const r = await open();
    S.choose(r.id, r.offers[0].id);
    await expect(S.rebid(r.id, 30_000)).rejects.toThrow();
  });
});
