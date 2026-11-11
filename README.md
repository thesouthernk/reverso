# Reverso

**The car market, the right way round.** Get every dealer's real out-the-door price on a new car, without giving anyone your phone number. Dealers compete for you in a sealed auction run by AI agents, and only the dealer you pick learns who you are. Dealers pay only for outcomes, through PayPal.

Built for the PayPal AI Hackathon 2026. Everything runs on the **PayPal sandbox**: no real money moves.

- Live demo: `[NEED: Render URL]`
- Demo video: `[NEED: YouTube URL]`

## The problem

Ask for the price of a new car online and you get calls instead of a price. Quote sites resell the same request as a lead to several dealers, and dealers pay for ads that follow you across every app. Everyone paid for you before you decided anything, so everyone chases you, and many still won't give a final price until you visit.

## How it works

**Buyer**
1. Says which car they want, in their own words. A Claude agent maps it to the catalog and asks only what a good salesperson would ask: where, how far they'd drive, whether they can wait, budget, how they'll pay, when they'll buy.
2. **Verifies their identity with PayPal**: a $1 authorization they approve in PayPal, which Reverso reads (name, email, payer ID) and voids at once. Nothing is charged.
3. The request goes to every dealer with **no name and no number**.
4. Each dealer's **Claude pricing agent** sends a sealed out-the-door offer within the floor its dealer set, then may improve it once after learning its position.
5. The buyer's **Claude agent reads every quote's fine print** (mandatory add-ons, doc fees, financing-only prices) and ranks offers by what this buyer would really pay.
6. The buyer picks one. Only that dealer receives their contact.
7. The buyer can **reserve the car with a $500 PayPal authorization** (refundable until they sign) or book a visit.
8. When they confirm the purchase, Reverso sends them a **$50 gas card through PayPal Payouts**, which is also how the sale gets confirmed.

**Dealer** (Bayside Motors in the demo)
- Funds a pay-per-outcome balance with **PayPal Checkout**.
- Watches requests, its agent's bid and its position live in an **AG Grid** board, and edits its price floors directly in an editable AG Grid.
- Pays $40 for a contact, $75 total if the buyer books a visit, $150 total if they reserve. No ad spend, no cold leads.
- If a buyer never answers, the contact fee is **refunded through the PayPal Refunds API**.

## PayPal integration

| What | PayPal API | Where |
| --- | --- | --- |
| Dealer funds its balance | Orders v2 (`CAPTURE`) + JS SDK buttons | `app/dealer/page.tsx`, `app/api/paypal/order`, `app/api/paypal/capture` |
| Buyer identity check | Orders v2 (`AUTHORIZE`) then Authorizations `void` | `app/api/paypal/verify`, `lib/paypal.ts` |
| Buyer reserves the car | Orders v2 (`AUTHORIZE`), $500 hold | `app/api/paypal/authorize` |
| Fee refund when a buyer never answers | Payments v2 Captures `refund` | `lib/store.ts` → `refundNoAnswer` |
| Gas card for confirming the purchase | Payouts v1 | `app/api/state` (`confirm`) |

Amounts are always decided on the server, never by the browser.

## AI

Three Claude agents (`lib/ai.ts`), all using structured outputs:
- **Buyer intake**: maps free text to a catalog model and pre-fills what the buyer already said.
- **Dealer pricing agents**: one per dealership, each with its own house style, stock and floor. They bid in two rounds.
- **Fine-print reviewer**: computes each offer's real cost for this buyer and explains the catch.

The public demo caps model use per visitor and per day (`lib/limit.ts`).

## Run it locally

```bash
cp .env.example .env.local   # fill in the three values
npm install
npm run dev -- -p 3210
```

Open `http://localhost:3210/dealer`, add $500 with PayPal using a sandbox personal account, then open `http://localhost:3210/` and ask for a car (try a Terra Hybrid Touring).

Sandbox buyer login for testing: `[NEED: judge sandbox account]`

## Notes

- State lives in memory on one server; a restart clears it.
- Car brands and models are invented on purpose.
- The SUV model is Kenney's Car Kit (CC0). The 3D film in `marketing/video2` is made with HyperFrames.

## License

MIT
