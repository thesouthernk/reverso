// The MCP server end to end over JSON-RPC, with Claude and PayPal replaced by fakes: no network, no cost.
import { describe, expect, it, vi } from "vitest";

vi.mock("./ai", async () => {
  const real = await vi.importActual<typeof import("./ai")>("./ai");
  return {
    CATALOG: real.CATALOG,
    dealerBid: vi.fn(async (p: { floor: number }) => ({ headline_price: p.floor + 300, perks: "In stock.", fine_print: "", reasoning: "fake" })),
    reviewOffers: vi.fn(async (_p: string, offers: { id: string; headline_price: number }[]) => ({ offers: offers.map((o) => ({ id: o.id, real_cost: o.headline_price, applies: true, note: "" })), summary: "fake" })),
  };
});
vi.mock("./paypal", () => ({ refundCapture: vi.fn() }));

import { handle } from "./mcp";
import * as S from "./store";

const req = new Request("http://x/api/mcp", { headers: { "x-forwarded-for": "10.0.0.1" } });
let n = 0;
const rpc = (method: string, params?: object) => handle({ jsonrpc: "2.0", id: ++n, method, params }, req) as Promise<any>;
const call = async (name: string, args: object = {}) => {
  const r = (await rpc("tools/call", { name, arguments: args })).result;
  return { error: r.isError ? r.content[0].text as string : null, data: r.isError ? null : JSON.parse(r.content[0].text) };
};

describe("MCP server", () => {
  it("speaks the protocol", async () => {
    expect((await rpc("initialize", { protocolVersion: "2025-06-18" })).result.serverInfo.name).toBe("reverso");
    expect(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, req)).toBeNull();
    const tools = (await rpc("tools/list")).result.tools;
    expect(tools.map((t: { name: string }) => t.name)).toContain("request_car");
    expect(tools.find((t: { name: string }) => t.name === "request_car").inputSchema.required).toContain("email");
  });

  it("buyer asks, sees anonymous offers, picks one; only that dealer gets the contact", async () => {
    S.demoCredit();
    const { data } = await call("request_car", { model: "Terra Hybrid", trim: "Touring", city: "Austin, TX", payment: "Cash", wait: "Up to 4 weeks", when: "This week", name: "Ana", email: "ana@example.com", phone: "5125550100" });
    await vi.waitFor(() => expect(S.buyerView(data.request_id)!.status).toBe("open"));

    expect((await call("get_offers", { request_id: data.request_id, request_key: "nope" })).error).toMatch(/Wrong request or key/);
    const offers = (await call("get_offers", { request_id: data.request_id, request_key: data.request_key })).data.offers;
    expect(offers.length).toBeGreaterThan(1);
    expect(offers.every((o: { dealer: unknown }) => o.dealer === null)).toBe(true);

    const bayside = S.buyerView(data.request_id)!.offers.find((o) => o.id === S.ME)!.label;
    const picked = (await call("choose_offer", { request_id: data.request_id, request_key: data.request_key, offer: bayside })).data;
    expect(picked.dealer).toBe("Bayside Motors");
    const buyers = (await call("dealer_account")).data.buyers;
    expect(buyers[0]).toMatchObject({ request: data.request_id, email: "ana@example.com", stage: "contact", paid: 40 });
    expect((await call("dealer_requests")).data.find((r: { request: string }) => r.request === data.request_id).buyer).toBe("Unverified");
  });

  it("validates input and lets the dealer set floors", async () => {
    expect((await call("request_car", { model: "Nope" })).error).toBeTruthy();
    expect((await call("dealer_set_floor", { model: "Lumen Sedan", trim: "S", floor: 30000 })).data.floor).toBe(30000);
    expect((await call("dealer_inventory")).data.find((c: { trim: string; model: string }) => c.model === "Lumen Sedan" && c.trim === "S").floor).toBe(30000);
    expect((await call("dealer_set_floor", { model: "Lumen Sedan", trim: "Nope", floor: 30000 })).error).toMatch(/Unknown/);
  });
});
