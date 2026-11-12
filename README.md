# Reverso

[![checks](https://github.com/thesouthernk/reverso/actions/workflows/checks.yml/badge.svg)](https://github.com/thesouthernk/reverso/actions/workflows/checks.yml)

**The car market, the right way round.** Get every dealer's real out-the-door price on a new car, without giving anyone your phone number. Dealers compete for you in a sealed auction run by AI agents, and only the dealer you pick learns who you are. Dealers pay only for outcomes, through PayPal.

Built for the PayPal AI Hackathon 2026. Everything runs on the **PayPal sandbox**: no real money moves.

- Live demo: https://reverso-moko.onrender.com (free instance: the first load after a quiet spell can take ~50 s)
- Demo video: https://youtu.be/_y_H04nVuEg

## The problem

Ask for the price of a new car online and you get calls instead of a price. Quote sites resell the same request as a lead to several dealers, and dealers pay for ads that follow you across every app. Everyone paid for you before you decided anything, so everyone chases you, and many still won't give a final price until you visit.

## How it works

**Buyer**
1. Says which car they want, in their own words. A Claude agent maps it to the catalog and asks only what a good salesperson would ask: where, how far they'd drive, whether they can wait, budget, how they'll pay, when they'll buy.
2. **Verifies their contact details** with a one-time code. (No SMS provider is connected in the demo, so the code is shown on screen.) Dealers never see these details unless the buyer picks them.
3. The request goes to every dealer with **no name and no number**.
4. Each dealer's **Claude pricing agent** sends a sealed out-the-door offer within the floor its dealer set, then may improve it once after learning its position.
5. The buyer's **Claude agent reads every quote's fine print** (mandatory add-ons, doc fees, financing-only prices) and ranks offers by what this buyer would really pay.
6. The buyer picks one, or **hands the deal to their closing agent**: a ceiling ("up to $37,400") and whether to set up the deposit. The agent negotiates with the dealers' agents (the counteroffers appear live in the chat), accepts the best real cost within the mandate, and **opens the $500 deposit order through PayPal's Agent Toolkit**. The buyer approves it in PayPal; the agent can't move money on its own. Either way, only the chosen dealer receives the buyer's contact.
7. The buyer can **reserve the car with a $500 PayPal authorization** (refundable until they sign) or book a visit.
8. When they confirm the purchase, Reverso sends them a **$50 gas card through PayPal Payouts**, which is also how the sale gets confirmed.

**Dealer** (Bayside Motors in the demo)
- Funds a pay-per-outcome balance with **PayPal Checkout**.
- Steers its AI agent from an **AG Grid** board. Every live request shows the agent's bid, the buyer's real cost, the position and the gap to the next offer ("Ahead by $49" or "Lead under $37,299"). Edit the floor on a live request and the agent re-bids on the spot: the grid shows "Re-bidding", then the new bid and position flash in, and the buyer's offer list re-ranks. Hover a bid to read the agent's reasoning, or the real cost to read the buyer's agent's note.
- Sets default floors per model and trim in a second editable AG Grid.
- Pays $40 for a contact, $75 total if the buyer books a visit, $150 total if they reserve. No ad spend, no cold leads.
- If a buyer never answers, the contact fee is **refunded through PayPal**: with one button, or by asking its **finance agent** ("Jordan never answered, refund the contact fee"), which checks the account and refunds through the **Agent Toolkit**.
- Sees two **AG Charts**: its position on each live request (floor, its real cost, best rival), and where its money went (fees by outcome and what PayPal sent back).

## PayPal integration

| What | PayPal API | Where |
| --- | --- | --- |
| Dealer funds its balance | Orders v2 (`CAPTURE`) + JS SDK buttons | `app/dealer/page.tsx`, `app/api/paypal/order`, `app/api/paypal/capture` |
| Buyer reserves the car | Orders v2 (`AUTHORIZE`), $500 hold | `app/api/paypal/authorize` |
| Fee refund when a buyer never answers | Payments v2 Captures `refund` | `lib/store.ts` → `refundNoAnswer` |
| Gas card for confirming the purchase | Payouts v1 | `app/api/state` (`confirm`) |
| Closing agent opens the deposit order | **Agent Toolkit** `create_order`, then `pay_order` after the buyer approves | `lib/deal-agent.ts` |
| Finance agent refunds an unanswered contact | **Agent Toolkit** `create_refund`, `get_refund`, `list_transactions` | `lib/finance-agent.ts` |

Amounts are always decided on the server, never by the browser.

### Agents that move money, behind a gate

`lib/agents.ts` runs Claude with tool use over two kinds of tools: Reverso's own (read the offers, counter, accept, read the account) and PayPal's **Agent Toolkit** (`@paypal/agent-toolkit`). Every Toolkit call goes through a **payment gate in code** before it reaches PayPal:
- the closing agent may create exactly one order, for exactly $500, only after it accepted an offer within the buyer's ceiling, and only if the buyer asked for a deposit. It never captures: the buyer approves in PayPal first.
- the finance agent may refund only what `plan_contact_refund` approved: the right capture, exactly $40, for a contact still marked unanswered.

A refused call comes back to the agent as an error and shows in the chat as "Payment gate". The model proposes; the code decides what money can move.

## AI

Five Claude agents. Three use structured outputs (`lib/ai.ts`):
- **Buyer intake**: maps free text to a catalog model and pre-fills what the buyer already said.
- **Dealer pricing agents**: one per dealership, each with its own house style, stock and floor. They bid in two rounds.
- **Fine-print reviewer**: computes each offer's real cost for this buyer and explains the catch.

Two use tool calling with the PayPal Agent Toolkit (`lib/deal-agent.ts`, `lib/finance-agent.ts`):
- **Closing agent** (buyer side): negotiates with up to three counteroffers, accepts within the mandate, opens the deposit order.
- **Finance agent** (dealer side): answers questions about spend and refunds unanswered contacts.

The public demo caps model use per visitor and per day (`lib/limit.ts`).

## Run it locally

```bash
cp .env.example .env.local   # fill in the three values
npm install
npm run dev -- -p 3210
```

`npm test` runs the marketplace rules (floors, who bids, pay-per-outcome charges, the PayPal refund, live re-bids) with Claude and PayPal replaced by fakes, so it needs no keys and costs nothing. CI runs it with the type check on every push.

Open `http://localhost:3210/dealer`, add $500 with PayPal using a sandbox personal account, then open `http://localhost:3210/` and ask for a car (try a Terra Hybrid Touring).

### Testing the live demo

Every PayPal window in the demo is the **PayPal sandbox**. Log in with this sandbox test account (fake money, $5,000 balance):

- Email: `sb-vrmzg53149912@personal.example.com`
- Password: `3NAdZT?e`

1. Open https://reverso-moko.onrender.com/dealer and press the PayPal button to add $500 to Bayside Motors' balance. (State lives in memory, so after a restart the balance starts at $0 again.)
2. Open https://reverso-moko.onrender.com/, press the first suggestion and answer the questions (choose "I need it on the lot now" to see the in-stock dealers compete).
3. Enter any name, email and phone, then the demo code shown on screen. The dealer agents bid; the auction takes about 30 seconds.
4. Optional, before picking: open the dealer view in another tab and change "Your floor" on the live request. The agent re-bids in a few seconds and the buyer's list re-ranks.
5. Either pick an offer yourself and reserve with PayPal, or press **Let my agent close it**: the closing agent negotiates (watch the counteroffers), accepts within your ceiling and opens the deposit order through the Agent Toolkit. Approve it in PayPal.
6. Press "Yes, I bought it" to receive the $50 gas card by PayPal Payouts.
7. In the dealer view, see the fees in the grid, the pipeline and the charts. To test the finance agent, let a second buyer pick Bayside and leave them unanswered, then type "<their name> never answered. Refund the contact fee." It refunds through the Agent Toolkit; the "Buyer didn't answer in 48 h: refund" button does the same through the REST API.

## Notes

- State lives in memory on one server; a restart clears it.
- Car brands and models are invented on purpose.
- Car photos: Pexels (free license), photos 27497575 and 27497656. The 3D SUV in the film is Kenney's Car Kit (CC0). The film in `marketing/video2` is made with HyperFrames.

## License

MIT
