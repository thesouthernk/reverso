// The marketplace state and its rules.
// ponytail: in-memory, one process; lost on restart. Move to a database before running more than one server.
import { CATALOG, dealerBid, reviewOffers, type DealerBid, type DealerPolicy } from "./ai";
import { refundCapture } from "./paypal";

export type Buyer = { name: string; email: string; phone: string; verified: boolean };
export type Profile = { city: string; travel: string; wait: string; budget: string; payment: string; when: string };
export type Offer = { id: string; dealerId: string; dealer: string; price: number; perks: string; finePrint: string; realCost: number; applies: boolean; note: string; round: number; improved: boolean; reasoning: string };
export type Stage = 0 | 1 | 2 | 3 | 4; // contact, visit, reserved, sold, refunded
export type Req = {
  id: string; createdAt: number; model: string; trim: string; msrp: number; profile: Profile; buyer: Buyer;
  status: "bidding" | "reviewing" | "open" | "chosen" | "failed"; error?: string;
  myFloor?: number; rebidding?: boolean; // Bayside's floor for this request, editable live from the dealer grid
  offers: Offer[]; summary: string; chosen?: string; holdUntil?: number;
  visit?: string; reservation?: { authorizationId: string; amount: number; voided?: boolean; paid?: boolean };
  agent?: { max: number; reserve: boolean; status: "negotiating" | "awaiting-approval" | "done" | "failed"; events: { at: number; from: string; text: string }[]; order?: string; counters: number };
  purchase?: { payoutBatch: string; amount: number };
};
export type Deal = { reqId: string; name: string; email: string; phone: string; car: string; price: number; stage: Stage; paid: number; refunded: number; visit?: string };
type TopUp = { captureId: string; amount: number; refunded: number; at: number };

export const ME = "bayside";
export const FEES = { contact: 40, visit: 75, reserve: 150 };
export const DEPOSIT = 500, GAS_CARD = 50, HOLD_MS = 30 * 60_000;
const TAX = 0.0625, DOC = 165;
export const otd = (msrp: number) => Math.round(msrp * (1 + TAX) + DOC);

// Each dealer agent gets a distinct strategy, so offers really differ.
const DEALERS: Omit<DealerPolicy, "floor">[] = [
  { id: "summit", name: "Summit Motors", distance: "11 miles", stock: "In stock.",
    style: "Your dealership's pricing system works like this, and you must follow it exactly: headline_price is the out-the-door price BEFORE the Protection Package and assumes the buyer finances with you. The Protection Package ($1,995: nitrogen-filled tires, door edge guards) is pre-installed and added at signing. Buyers who do not finance with you pay $1,000 more. Your perks line only advertises the price and stock; the package and the financing condition appear in fine_print, which you write accurately." },
  { id: ME, name: "Bayside Motors", distance: "8 miles", stock: "On the lot today, Lunar Gray.",
    style: "Transparent pricing: no add-ons and no conditions; the headline is exactly what the buyer pays. Open about $700 above your floor. This is a verified buyer ready to buy, which is worth more to you than margin: when a buyer's agent pushes or you are behind, come down in real steps, never below your floor." },
  { id: "lakeshore", name: "Lakeshore Motors", distance: "14 miles", stock: "Not in stock: factory order, arrives in 4 weeks.",
    style: "Volume dealer: you win on price. Open about $500 above your floor and move down fast when pushed or behind. Be honest that the car arrives in 4 weeks." },
  { id: "northgate", name: "Northgate Motors", distance: "19 miles", stock: "In stock.",
    style: "Premium dealer: every car carries a $1,500 market adjustment, included in your out-the-door price. You include all-weather mats and 2 years of maintenance and you rarely discount." },
];
const FLOOR_PCT: Record<string, number> = { summit: 1.0, lakeshore: 0.955, northgate: 1.035 }; // Summit folds its $1,995 package into an all-in quote

type Log = { at: number; text: string };
type Spend = { contact: number; visit: number; reserve: number; refunded: number };
const spend = (s: Store) => (s.spend ??= { contact: 0, visit: 0, reserve: 0, refunded: 0 });
type Store = {
  seq: number; reqs: Req[]; deals: Deal[]; log: Log[];
  balance: number; topups: TopUp[];
  spend?: Spend; // fees charged by outcome and refunded through PayPal, for the dealer's chart
  floors: Record<string, number>; // "Model|Trim" -> Bayside's out-the-door floor, edited in the dealer grid
};
const g = globalThis as unknown as { __reverso?: Store };
function fresh(): Store {
  const floors: Record<string, number> = {};
  CATALOG.forEach((c) => c.trims.forEach((t) => { floors[`${c.model}|${t}`] = Math.round(otd((c.msrp as Record<string, number>)[t]) * 0.955 / 50) * 50; }));
  return { seq: 4820, reqs: [], deals: [], log: [], balance: 0, topups: [], floors };
}
export const store = () => (g.__reverso ??= fresh());
const log = (text: string) => store().log.unshift({ at: Date.now(), text });
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

// ---------- dealer side ----------
export function addTopUp(captureId: string, amount: number) {
  const s = store(); s.topups.push({ captureId, amount, refunded: 0, at: Date.now() }); s.balance += amount;
  log(`Balance topped up with PayPal: ${usd(amount)}.`);
}
export function setFloor(key: string, floor: number) {
  const s = store(); if (!(key in s.floors) || !Number.isFinite(floor) || floor < 1000) return false;
  s.floors[key] = Math.round(floor); log(`Floor for ${key.replace("|", " ")} set to ${usd(floor)}.`); return true;
}
function charge(reqId: string, total: number, why: string, kind: "contact" | "visit" | "reserve") {
  const s = store(), d = s.deals.find((x) => x.reqId === reqId); if (!d) return;
  const extra = Math.max(0, total - d.paid); if (!extra) return;
  s.balance -= extra; d.paid += extra; spend(s)[kind] += extra; log(`${why} ${usd(extra)} charged from your PayPal-funded balance.`);
}
/** Which PayPal top-up capture an unanswered contact's fee can go back against. Throws when it isn't refundable. */
export function refundPlan(reqId: string) {
  const s = store(), d = s.deals.find((x) => x.reqId === reqId);
  if (!d || d.stage !== 0 || d.refunded) throw new Error("Only an unanswered new contact can be refunded");
  const amount = Math.min(d.paid, FEES.contact);
  const src = s.topups.find((t) => t.amount - t.refunded >= amount);
  if (!src) throw new Error("No PayPal top-up left to refund against");
  return { captureId: src.captureId, amount };
}
export function applyRefund(reqId: string, captureId: string, amount: number, refundId: string, by = "") {
  const s = store(), d = s.deals.find((x) => x.reqId === reqId)!, src = s.topups.find((t) => t.captureId === captureId)!;
  src.refunded += amount; d.refunded = amount; d.stage = 4; spend(s).refunded += amount; // the fee returns to the dealer's PayPal account, not to the balance
  log(`Buyer ${reqId} never answered. ${usd(amount)} refunded to you through PayPal${by} (refund ${refundId}).`);
}
/** No answer within 48 hours: the contact fee goes back through PayPal. */
export async function refundNoAnswer(reqId: string) {
  const { captureId, amount } = refundPlan(reqId);
  const r = await refundCapture(captureId, amount, `Reverso: buyer ${reqId} did not answer within 48 hours`, `refund-${reqId}`);
  applyRefund(reqId, captureId, amount, r.id);
  return r;
}

// ---------- buyer side ----------
export function createRequest(model: string, trim: string, profile: Profile, buyer: Buyer): Req {
  const s = store(), c = CATALOG.find((x) => x.model === model);
  if (!c) throw new Error("That model is not in the catalog");
  const t = (c.trims as readonly string[]).includes(trim) ? trim : c.trims[0];
  const r: Req = { id: `#${++s.seq}`, createdAt: Date.now(), model, trim: t, msrp: (c.msrp as Record<string, number>)[t], profile, buyer, status: "bidding", offers: [], summary: "" };
  s.reqs.unshift(r);
  log(`Request ${r.id} arrived: ${model} ${t}. ${profile.payment}, buying ${profile.when.toLowerCase()}. Verified buyer, identity hidden.`);
  void runAuction(r).catch((e) => { r.status = "failed"; r.error = String(e.message ?? e); log(`Request ${r.id}: the auction failed (${r.error}).`); });
  return r;
}

export const policyFor = (r: Req, dealerId: string) => {
  const d = DEALERS.find((x) => x.id === dealerId)!;
  return { ...d, floor: d.id === ME ? r.myFloor ?? store().floors[`${r.model}|${r.trim}`] : Math.round(otd(r.msrp) * FLOOR_PCT[d.id]) };
};
export const note = (text: string) => log(text);

function policies(r: Req): DealerPolicy[] {
  const s = store(), base = otd(r.msrp);
  return DEALERS
    .filter((d) => !(d.id === "lakeshore" && r.profile.wait.startsWith("I need it")))
    .filter((d) => !(d.id === ME && s.balance < FEES.reserve))
    .map((d) => ({ ...d, floor: d.id === ME ? s.floors[`${r.model}|${r.trim}`] : Math.round(base * FLOOR_PCT[d.id]) }));
}

async function runAuction(r: Req) {
  const s = store(), ps = policies(r);
  r.myFloor = ps.find((p) => p.id === ME)?.floor;
  if (store().balance < FEES.reserve) log(`Request ${r.id}: your agent sat this one out. Top up at least ${usd(FEES.reserve)} to bid.`);
  const ask = { model: r.model, trim: r.trim, msrp: r.msrp, payment: r.profile.payment, when: r.profile.when, budget: r.profile.budget };
  const bids = new Map<string, DealerBid>();
  // Round 1: every dealer agent bids at once; each offer appears as it lands.
  await Promise.all(ps.map(async (p) => {
    const b = await dealerBid(p, ask, { n: 1 }); const price = Math.max(p.floor, Math.round(b.headline_price));
    bids.set(p.id, { ...b, headline_price: price });
    r.offers.push({ id: p.id, dealerId: p.id, dealer: p.name, price, perks: b.perks, finePrint: b.fine_print, realCost: price, applies: true, note: "", round: 1, improved: false, reasoning: b.reasoning });
    if (p.id === ME) log(`Your agent bid ${usd(price)} out the door (floor ${usd(p.floor)}). ${b.reasoning}`);
  }));
  await review(r);
  // Round 2: everyone behind the leader may improve once, never below its floor.
  const ranked = () => [...r.offers].sort((a, b) => a.realCost - b.realCost);
  const leader = ranked()[0];
  await Promise.all(ps.filter((p) => p.id !== leader.dealerId).map(async (p) => {
    const mine = r.offers.find((o) => o.dealerId === p.id)!, pos = ranked().findIndex((o) => o.dealerId === p.id) + 1;
    const b = await dealerBid(p, ask, { n: 2, myLast: mine.price, position: `${pos} of ${r.offers.length}`, best: leader.realCost });
    const price = Math.max(p.floor, Math.round(b.headline_price));
    if (price < mine.price) { Object.assign(mine, { price, perks: b.perks, finePrint: b.fine_print, round: 2, improved: true, reasoning: b.reasoning }); bids.set(p.id, { ...b, headline_price: price });
      if (p.id === ME) log(`Your agent improved to ${usd(price)}, still above your floor. ${b.reasoning}`); }
    else if (p.id === ME) log(`Your agent held at ${usd(mine.price)}. ${b.reasoning}`);
  }));
  await review(r);
  const pos = ranked().findIndex((o) => o.dealerId === ME);
  if (pos >= 0) log(`Request ${r.id}: offers are in. You are ${pos + 1} of ${r.offers.length} by the buyer's real cost.`);
  r.status = "open";
}

/** The dealer edits this request's floor in the grid; its agent re-bids on the spot and the buyer's agent re-ranks. */
export async function rebid(reqId: string, floor: number) {
  const s = store(), r = s.reqs.find((x) => x.id === reqId), mine = r?.offers.find((o) => o.dealerId === ME);
  if (!r || !mine || r.status !== "open" || r.chosen || r.rebidding) throw new Error("This request can't be re-bid now");
  if (!Number.isFinite(floor) || floor < 1000) throw new Error("Enter a valid floor");
  const p = { ...DEALERS.find((d) => d.id === ME)!, floor: Math.round(floor) };
  const others = r.offers.filter((o) => o !== mine).sort((a, b) => a.realCost - b.realCost);
  const pos = [...r.offers].sort((a, b) => a.realCost - b.realCost).indexOf(mine) + 1;
  r.myFloor = p.floor; r.rebidding = true; r.status = "reviewing";
  log(`Request ${r.id}: floor changed to ${usd(p.floor)}. Your agent is re-bidding.`);
  try {
    const b = await dealerBid(p, { model: r.model, trim: r.trim, msrp: r.msrp, payment: r.profile.payment, when: r.profile.when, budget: r.profile.budget },
      { n: 2, myLast: mine.price, position: `${pos} of ${r.offers.length}`, best: others[0]?.realCost ?? mine.realCost });
    const price = Math.max(p.floor, Math.round(b.headline_price));
    if (price !== mine.price) Object.assign(mine, { price, perks: b.perks, finePrint: b.fine_print, improved: price < mine.price || mine.improved, reasoning: b.reasoning });
    await review(r);
    const now = [...r.offers].sort((a, c) => a.realCost - c.realCost).indexOf(mine) + 1;
    log(`Request ${r.id}: your agent bid ${usd(mine.price)} and ${now === pos ? "stays" : `moved from ${pos} to`} ${now} of ${r.offers.length}. ${b.reasoning}`);
  } catch (e) { log(`Request ${r.id}: re-bid failed (${(e as Error).message}). Your previous offer stands.`); }
  finally { r.rebidding = false; if (r.status === "reviewing") r.status = "open"; }
}

async function review(r: Req) {
  r.status = "reviewing";
  const res = await reviewOffers(r.profile.payment, r.offers.map((o) => ({ id: o.id, headline_price: o.price, perks: o.perks, fine_print: o.finePrint })));
  for (const v of res.offers) { const o = r.offers.find((x) => x.id === v.id); if (o) Object.assign(o, { realCost: Math.round(v.real_cost), applies: v.applies, note: v.note }); }
  r.summary = res.summary;
}

export function choose(reqId: string, offerId: string) {
  const s = store(), r = s.reqs.find((x) => x.id === reqId), o = r?.offers.find((x) => x.id === offerId);
  if (!r || !o || r.chosen || r.status !== "open") throw new Error("This offer can't be chosen now");
  r.chosen = offerId; r.status = "chosen"; r.holdUntil = Date.now() + HOLD_MS;
  if (o.dealerId === ME) {
    s.deals.unshift({ reqId, name: r.buyer.name, email: r.buyer.email, phone: r.buyer.phone, car: `${r.model} ${r.trim}`, price: o.price, stage: 0, paid: 0, refunded: 0 });
    charge(reqId, FEES.contact, `The buyer of ${reqId} chose you. Contact released;`, "contact");
  } else log(`The buyer of ${reqId} chose another dealer. You paid nothing.`);
}
const mineChosen = (r: Req) => r.offers.find((o) => o.id === r.chosen)?.dealerId === ME;

export function bookVisit(reqId: string, slot: string) {
  const s = store(), r = s.reqs.find((x) => x.id === reqId); if (!r?.chosen || r.visit) throw new Error("Can't book a visit now");
  r.visit = slot;
  const d = s.deals.find((x) => x.reqId === reqId); if (d && mineChosen(r)) { d.visit = slot; d.stage = Math.max(d.stage, 1) as Stage; charge(reqId, FEES.visit, `Visit booked for ${slot};`, "visit"); }
}
export function reserve(reqId: string, authorizationId: string, amount: number, paid = false) {
  const s = store(), r = s.reqs.find((x) => x.id === reqId); if (!r?.chosen || r.reservation) throw new Error("Can't reserve now");
  r.reservation = { authorizationId, amount, paid };
  const d = s.deals.find((x) => x.reqId === reqId); if (d && mineChosen(r)) { d.stage = Math.max(d.stage, 2) as Stage; charge(reqId, FEES.reserve, `The buyer of ${reqId} reserved with a ${usd(amount)} PayPal deposit;`, "reserve"); }
}
export function confirmPurchase(reqId: string, payoutBatch: string) {
  const s = store(), r = s.reqs.find((x) => x.id === reqId); if (!r?.chosen || r.purchase) throw new Error("Can't confirm now");
  r.purchase = { payoutBatch, amount: GAS_CARD };
  const d = s.deals.find((x) => x.reqId === reqId); if (d && mineChosen(r)) { d.stage = 3; log(`Sale confirmed by the buyer of ${reqId}. Reverso sent them a ${usd(GAS_CARD)} gas card through PayPal.`); }
}

// ---------- views: each side sees only what it may ----------
export function buyerView(id: string) {
  const r = store().reqs.find((x) => x.id === id); if (!r) return null;
  return {
    id: r.id, model: r.model, trim: r.trim, profile: r.profile, status: r.status, error: r.error ?? null, summary: r.summary,
    chosen: r.chosen ?? null, holdUntil: r.holdUntil ?? null, visit: r.visit ?? null, reserved: !!r.reservation && !r.reservation.voided,
    purchased: !!r.purchase, deposit: DEPOSIT, gasCard: GAS_CARD, buyer: { name: r.buyer.name, email: r.buyer.email }, depositPaid: !!r.reservation?.paid,
    agent: r.agent ? { max: r.agent.max, reserve: r.agent.reserve, status: r.agent.status, events: r.agent.events, order: r.agent.order ?? null } : null,
    offers: [...r.offers].sort((a, b) => a.realCost - b.realCost).map((o) => ({
      id: o.id, label: `Offer ${"ABCD"[r.offers.indexOf(o)]}`, dealer: r.chosen === o.id ? o.dealer : null, price: o.price, realCost: o.realCost, perks: o.perks, note: o.note, applies: o.applies, improved: o.improved,
      distance: r.chosen === o.id ? DEALERS.find((d) => d.id === o.dealerId)?.distance : null,
    })),
  };
}
export function dealerView() {
  const s = store();
  return {
    dealer: "Bayside Motors", balance: s.balance, fees: FEES, log: s.log.slice(0, 14), deals: s.deals, spend: spend(s),
    topups: s.topups.map((t) => ({ amount: t.amount, refunded: t.refunded, at: t.at })),
    inventory: CATALOG.flatMap((c) => c.trims.map((t) => ({ key: `${c.model}|${t}`, model: c.model, trim: t, msrp: (c.msrp as Record<string, number>)[t], otd: otd((c.msrp as Record<string, number>)[t]), floor: s.floors[`${c.model}|${t}`] }))),
    rows: s.reqs.map((r) => {
      const mine = r.offers.find((o) => o.dealerId === ME), ranked = [...r.offers].sort((a, b) => a.realCost - b.realCost);
      const won = !!r.chosen && mine?.id === r.chosen, best = ranked.find((o) => o !== mine);
      return { id: r.id, model: `${r.model} ${r.trim}`, payment: r.profile.payment, budget: r.profile.budget, when: r.profile.when, buyer: r.buyer.verified ? "Verified" : "Unverified",
        bids: r.offers.length, myPrice: mine?.price ?? null, rank: mine ? ranked.findIndex((o) => o.id === mine.id) + 1 : null,
        myFloor: mine ? r.myFloor ?? null : null, myRealCost: mine?.realCost ?? null, bestRival: mine && best ? best.realCost : null, reasoning: mine?.reasoning ?? "", note: mine?.note ?? "",
        // What real cost the buyer must see from you to lead: just under the best rival.
        toLead: mine && best && ranked[0] !== mine ? best.realCost - 1 : null,
        aheadBy: mine && best && ranked[0] === mine ? best.realCost - mine.realCost : null, // room to raise your floor and still lead
        status: won ? "Chosen" : r.chosen ? "Lost" : r.status === "failed" ? "Failed" : r.rebidding ? "Re-bidding" : mine ? (r.status === "open" ? "Bidding" : "Live") : r.status === "bidding" ? "New" : "Sat out" };
    }),
  };
}
