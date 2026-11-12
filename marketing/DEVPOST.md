# Reverso — Devpost copy

**Tagline:** Dealers compete for you, and only the one you pick learns who you are.

- Live demo: https://reverso-moko.onrender.com (free instance: first load can take ~50 s)
- Code: https://github.com/thesouthernk/reverso (MIT)
- Video: https://youtu.be/SOPSfoLIK7U

## Inspiration
Ask for the price of a new car online and you get calls instead. Quote sites resell the same request as a lead to several dealers, and dealers pay for ads that follow you across every app. They all paid for you before you decided anything, so they all chase you, and many still won't give a final price until you visit.

## What it does
Reverso reverses that order.
- A buyer tells an AI agent which new car they want, in their own words. The agent maps it to a model and asks only what changes the price: city, how far they'll travel, how long they can wait, budget, how they'll pay, and when they're buying.
- The buyer confirms their name, email and phone with a one-time code. Dealers never see any of it at this stage.
- Each dealer has its own AI agent that bids a sealed out-the-door price inside a floor the dealer set, then gets one chance to improve.
- The buyer's agent reads every quote's fine print and ranks them by real cost. A quote that looks cheapest but adds a mandatory package and only holds with dealer financing drops to last.
- The buyer picks one offer. Only that dealer receives their contact.
- The buyer sees the exact car, gets the price held for 30 minutes, and can reserve it with a refundable $500 PayPal authorization or book a visit.
- When the buyer confirms they bought the car, PayPal Payouts sends them a $50 gas card. That closes the loop: we know the sale happened.
- Dealers fund a balance with PayPal and pay per outcome: $40 for a contact, $75 for a booked visit, $150 for a reservation. If the buyer doesn't answer in 48 hours, the contact fee goes back through a PayPal refund.
- Dealers steer their AI agent from an AG Grid board. Each live request shows the agent's bid, the buyer's real cost, the position and the gap to the next offer ("Ahead by $49" or "Lead under $37,299"). Edit the floor on a live request and the agent re-bids on the spot: the row shows "Re-bidding", the new bid and position flash in, and the buyer's offer list re-ranks. Hovering a bid shows the agent's reasoning; hovering the real cost shows the buyer's agent's note. A second editable grid sets default floors per model and trim, and chosen buyers move through a pipeline.

## How we built it
- Next.js (App Router) and React, AG Grid Community for the dealer board and floor editor, hosted on Render.
- Claude (Anthropic API, structured outputs) runs three jobs: parsing the buyer's request, one bidding agent per dealer with its own strategy, and the fine-print review that computes real cost.
- PayPal sandbox REST APIs: Orders v2 capture (dealer top-ups), Orders v2 authorize and void (refundable reservation deposit), Captures refund (contact fee back when a buyer goes silent), Payouts (gas card), and the JS SDK buttons.

## Challenges we ran into
- Our first identity check used Log in with PayPal, which isn't available in every country, and buyers didn't want to hand over a PayPal account just to see a price. We switched to a one-time code on the buyer's own contact details.
- Early dealer agents converged on nearly identical prices. Giving each dealer a distinct strategy and floor (premium with add-ons, volume with a long wait, transparent pricing) made the comparison meaningful.
- Fine print is where car prices hide. The review agent has to separate real costs (mandatory packages, financing conditions) from taxes and fees every buyer pays anyway.

## What's next
Real SMS verification, dealer inventory feeds, persistent storage, used cars and trade-ins.
