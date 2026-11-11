# Reverso — Devpost copy (draft)

**Tagline (pick one)**
- A. Every dealer's real price on a new car. Your number stays yours.
- B. Dealers compete for you, and only the one you pick learns who you are.
- C. The car market, the right way round.

## Inspiration
Ask for the price of a new car online and you get calls instead. Quote sites resell the same request as a lead to several dealers, and dealers pay for ads that follow you across every app. They all paid for you before you decided anything, so they all chase you, and many still won't give a final price until you visit.

## What it does
Reverso reverses that order.
- A buyer tells an AI agent which new car they want. The agent asks where they are, how they will pay, their budget and when they plan to buy, then verifies their identity with PayPal.
- The request goes to dealers with no name and no phone number.
- Dealers' agents reply with sealed, out-the-door prices. The buyer's agent ranks them by real cost and explains conditions and mandatory extras that a quote leaves out.
- The buyer picks one offer. Only that dealer receives their contact.
- The buyer sees the exact car, gets the price held for 30 minutes, and can reserve it with a refundable PayPal deposit or book a visit.
- Dealers pay per outcome through PayPal: $40 for a contact, $75 for a booked visit, $150 for a paid reservation. [NEED: built] The charge is refunded automatically if the buyer does not answer or the sale falls through.
- Dealers watch requests, their bid and their position live in an AG Grid board, and follow chosen buyers through a pipeline.

## How we built it
[NEED: fill in once integrated] Next.js, AG Grid, Claude (buyer agent, dealer agents, offer analysis), PayPal sandbox (identity, deposit, dealer charges, refunds), hosted on Render.

## Challenges we ran into
[NEED: write after the build]

## What's next
Used cars, trade-ins, and real dealer inventory feeds.
