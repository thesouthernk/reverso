// The agents. Every model call goes through here.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic();
const MODEL = process.env.REVERSO_MODEL ?? "claude-opus-5-5";

async function ask<T extends z.ZodType>(schema: T, system: string, user: string, effort: "low" | "medium" = "low"): Promise<z.infer<T>> {
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(schema), effort },
  });
  if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`Model gave no usable answer (${res.stop_reason})`);
  return res.parsed_output as z.infer<T>;
}

// ---------- the catalog: invented models, so no real brand appears ----------
export const CATALOG = [
  { model: "Terra Hybrid", trims: ["LE", "Touring", "Limited"], msrp: { LE: 33900, Touring: 36500, Limited: 39900 }, kind: "hybrid midsize SUV" },
  { model: "Terra Compact", trims: ["S", "SE"], msrp: { S: 27900, SE: 30400 }, kind: "compact SUV" },
  { model: "Lumen Sedan", trims: ["S", "XS"], msrp: { S: 29500, XS: 32800 }, kind: "midsize sedan" },
  { model: "Haul Pickup", trims: ["Sport", "Off-Road"], msrp: { Sport: 41200, "Off-Road": 46900 }, kind: "midsize pickup" },
] as const;

const Parsed = z.object({
  model: z.string().describe("Exactly one catalog model name, or 'none' if the request matches nothing in the catalog"),
  trim: z.string().describe("A trim of that model; the most likely one if the buyer did not say"),
  answered: z.object({
    city: z.string().nullable(),
    payment: z.enum(["Cash", "My own bank or credit union loan", "Open to dealer financing"]).nullable(),
    budget: z.string().nullable(),
    when: z.enum(["This week", "This month", "Just researching"]).nullable(),
  }).describe("Anything the buyer already told us; null when not said"),
  reply: z.string().describe("One short, friendly sentence confirming the car, in plain English"),
});
export type ParsedRequest = z.infer<typeof Parsed>;

/** The buyer's agent reads the first message. */
export const parseRequest = (text: string) =>
  ask(Parsed,
    `You are Reverso, a buyer's agent for new cars in the US. Map the buyer's message to the dealer catalog below. Real brand names the buyer mentions should be mapped to the closest catalog model: match powertrain first (a hybrid request maps to a hybrid), then body type and size. Catalog:\n${JSON.stringify(CATALOG)}`,
    text);

// ---------- dealer agents ----------
export type DealerPolicy = { id: string; name: string; distance: string; stock: string; style: string; floor: number };

const Bid = z.object({
  headline_price: z.number().describe("The out-the-door price in USD you advertise to the buyer"),
  perks: z.string().describe("One short line the buyer sees under the price"),
  fine_print: z.string().describe("The full terms of this quote, as a dealer would write them"),
  reasoning: z.string().describe("One sentence for your dealership's own log: why this number"),
});
export type DealerBid = z.infer<typeof Bid>;

export function dealerBid(d: DealerPolicy, req: { model: string; trim: string; msrp: number; payment: string; when: string; budget: string }, round: { n: number; myLast?: number; position?: string; best?: number }) {
  return ask(Bid,
    `You are the pricing agent of ${d.name}, a new-car dealership ${d.distance} from the buyer. You compete in a sealed, anonymous auction: the buyer is verified and only the dealer they pick gets their contact. ` +
    `Your house style: ${d.style} Stock: ${d.stock} Never quote an out-the-door price below your floor of $${d.floor}. Texas sales tax is 6.25% and your doc fee is $165; out-the-door means tax and fees included.`,
    `Request: new ${req.model} ${req.trim} (MSRP $${req.msrp}). Buyer pays: ${req.payment}. Buying: ${req.when}. Budget: ${req.budget}.\n` +
    (round.n === 1 ? "Make your opening sealed offer." :
      `Round 2. Your last offer was $${round.myLast}. Ranked by the buyer's real cost you are ${round.position}; the best real cost so far is $${round.best}. Improve your offer if it makes business sense, staying at or above your floor, or hold it.`));
}

// ---------- the buyer's agent reads the fine print ----------
const Review = z.object({
  offers: z.array(z.object({
    id: z.string(),
    real_cost: z.number().describe("What this buyer would actually pay, out the door, given how they pay"),
    applies: z.boolean().describe("False when a condition of the quote does not hold for this buyer"),
    note: z.string().describe("Empty when the quote is clean; otherwise one plain sentence naming the catch and the real cost"),
  })),
  summary: z.string().describe("Two sentences to the buyer: which offer is best by real cost and why, and the biggest catch you found"),
});
export type OfferReview = z.infer<typeof Review>;

export const reviewOffers = (payment: string, offers: { id: string; headline_price: number; perks: string; fine_print: string }[]) =>
  ask(Review,
    "You are the buyer's agent. Read every sealed quote's fine print and compute what this buyer would really pay out the door: price, sales tax, doc fee and any mandatory add-ons. Ignore title and registration, which are state fees identical at every dealer, and never estimate them. Add mandatory add-ons and fees the headline leaves out. If a price only holds with dealer financing and the buyer will not use dealer financing, use the price that applies to them (the fine print usually states it); if it does not, add a reasonable estimate and say so. Be exact with arithmetic.",
    `The buyer pays with: ${payment}.\nQuotes:\n${JSON.stringify(offers, null, 2)}`,
    "medium");
