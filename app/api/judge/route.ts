// Judge mode: one click gives a verified buyer, a dealer with balance, and a running auction.
import { createRequest, demoCredit } from "@/lib/store";
import { currentBuyer, saveBuyer } from "@/lib/session";
import { allow } from "@/lib/limit";

const JUDGE = {
  text: "I want a new hybrid midsize SUV, the Terra Hybrid Touring. I just want the real out-the-door price, without ten salespeople calling me.",
  model: "Terra Hybrid", trim: "Touring",
  reply: "Got it: a new Terra Hybrid Touring, the hybrid midsize SUV.",
  profile: { city: "Austin, TX", travel: "Up to 25 miles", wait: "Up to 4 weeks", budget: "Up to $40,000", payment: "Cash", when: "This week" },
};

export async function POST(request: Request) {
  if (!allow(request, "auction", 6, 120)) return Response.json({ error: "Demo limit reached. Try again in an hour." }, { status: 429 });
  const buyer = (await currentBuyer()) ?? { name: "Jordan Reed", email: "jordan.reed@example.com", phone: "+1 512 555 0142", verified: true };
  if (!buyer.verified) return Response.json({ error: "Verify first" }, { status: 401 });
  await saveBuyer(buyer);
  demoCredit();
  const r = createRequest(JUDGE.model, JUDGE.trim, JUDGE.profile, buyer);
  return Response.json({ id: r.id, buyer, ...JUDGE });
}
