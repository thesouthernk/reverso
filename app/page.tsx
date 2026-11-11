"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Offer = { id: string; dealer: string | null; distance: string | null; price: number; realCost: number; perks: string; note: string; applies: boolean; improved: boolean };
type Profile = { city: string; travel: string; wait: string; budget: string; payment: string; when: string };
type Req = {
  id: string; model: string; trim: string; profile: Profile; status: "bidding" | "reviewing" | "open" | "chosen" | "failed"; error: string | null; summary: string;
  chosen: string | null; holdUntil: number | null; visit: string | null; reserved: boolean; purchased: boolean; deposit: number; gasCard: number;
  buyer: { name: string; email: string }; offers: Offer[];
};
type Buyer = { name: string; email: string; verified: boolean };
type Parsed = { model: string; trim: string; reply: string; answered: Partial<Record<keyof Profile, string | null>> };

const usd = (n: number) => "$" + new Intl.NumberFormat("en-US").format(Math.round(n));
const SUGGESTIONS = [
  "I want a new hybrid midsize SUV, the Terra Hybrid Touring. I just want the real out-the-door price, without ten salespeople calling me.",
  "A new Lumen Sedan XS. What's the lowest out-the-door price near me?",
];
const QUESTIONS: { key: keyof Profile; ask: string; options: string[] }[] = [
  { key: "city", ask: "Where are you? A city or ZIP code is enough.", options: ["Austin, TX", "Round Rock, TX", "San Marcos, TX"] },
  { key: "travel", ask: "How far would you go to pick it up?", options: ["Up to 25 miles", "Up to 100 miles", "Anywhere, if they deliver"] },
  { key: "wait", ask: "Can you wait for the car, or do you need one that's on the lot?", options: ["I need it on the lot now", "Up to 4 weeks", "I can wait longer"] },
  { key: "budget", ask: "What's your ceiling, out the door?", options: ["Up to $38,000", "Up to $40,000", "No fixed ceiling"] },
  { key: "payment", ask: "How will you pay? It changes the price dealers can offer.", options: ["Cash", "My own bank or credit union loan", "Open to dealer financing"] },
  { key: "when", ask: "When do you plan to buy?", options: ["This week", "This month", "Just researching"] },
];
const SLOTS = ["Tomorrow, 10:00 am", "Tomorrow, 5:30 pm", "Saturday, 11:00 am"];

declare global { interface Window { paypal?: { Buttons: (o: object) => { render: (el: HTMLElement) => Promise<void> } } } }

/** Loads PayPal's checkout script once, for the given intent. */
function usePayPal(clientId: string | null, intent: "authorize" | "capture") {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!clientId) return;
    if (window.paypal) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=${intent}&components=buttons`;
    s.onload = () => setReady(true);
    document.body.appendChild(s);
  }, [clientId, intent]);
  return ready;
}

function PayPalButton({ ready, createOrder, onApprove, onError }: { ready: boolean; createOrder: () => Promise<string>; onApprove: (orderId: string) => Promise<void>; onError: (m: string) => void }) {
  const box = useRef<HTMLDivElement>(null), done = useRef(false);
  useEffect(() => {
    if (!ready || !box.current || done.current || !window.paypal) return;
    done.current = true;
    window.paypal.Buttons({
      style: { layout: "horizontal", shape: "pill", color: "black", label: "paypal", tagline: false, height: 46 },
      createOrder, onApprove: (d: { orderID: string }) => onApprove(d.orderID), onError: (e: Error) => onError(String(e?.message ?? e)),
    }).render(box.current);
  }, [ready, createOrder, onApprove, onError]);
  return <div ref={box} className="ppbox" />;
}

function Hold({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.round((until - now) / 1000));
  if (left === 0) return <p className="hold over">The hold on this price ended. Ask the dealer to renew it.</p>;
  return <p className="hold" role="timer">Price held for you for <strong>{String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}</strong></p>;
}

function Words({ text }: { text: string }) {
  return (
    <div className="agent">
      <span className="spark" aria-hidden />
      <p>{text.split(" ").map((w, i) => <span key={i} className="word" style={{ animationDelay: `${i * 28}ms` }}>{w} </span>)}</p>
    </div>
  );
}

export default function BuyerPage() {
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [answers, setAnswers] = useState<Partial<Profile>>({});
  const [typed, setTyped] = useState("");
  const [me, setMe] = useState<{ buyer: Buyer | null; clientId: string } | null>(null);
  const [reqId, setReqId] = useState<string | null>(null);
  const [req, setReq] = useState<Req | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const ppReady = usePayPal(parsed ? me?.clientId ?? null : null, "authorize");

  // Who is this buyer? (Verified earlier in this browser session, or not yet.)
  useEffect(() => { fetch("/api/state?as=me").then((r) => r.json()).then(setMe); }, []);

  const missing = parsed ? QUESTIONS.filter((q) => !answers[q.key]) : [];
  const verified = !!me?.buyer;

  // Publish once everything is known and the buyer is verified.
  const published = useRef(false);
  useEffect(() => {
    if (!parsed || missing.length || !verified || published.current || reqId) return;
    published.current = true;
    setBusy("Sending your request");
    fetch("/api/state", { method: "POST", body: JSON.stringify({ action: "request", model: parsed.model, trim: parsed.trim, profile: answers }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setReqId(j.id); })
      .catch((e) => { setErr(String(e.message)); published.current = false; })
      .finally(() => setBusy(""));
  }, [parsed, missing.length, verified, reqId, answers]);

  const refresh = useCallback(async () => {
    if (!reqId) return;
    const r = await fetch(`/api/state?as=buyer&id=${encodeURIComponent(reqId)}`);
    if (r.ok) setReq(await r.json());
  }, [reqId]);
  useEffect(() => {
    if (!reqId) return;
    refresh();
    const t = setInterval(refresh, 1200);
    return () => clearInterval(t);
  }, [reqId, refresh]);

  const count = req?.offers.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [sent, parsed, Object.keys(answers).length, count, req?.status, req?.chosen, req?.reserved, req?.visit, req?.purchased, confirming, booking, verified, err]);

  async function send(text: string) {
    if (!text.trim() || sent) return;
    setSent(text.trim()); setErr(""); setBusy("Reading your request");
    try {
      const r = await fetch("/api/parse", { method: "POST", body: JSON.stringify({ text }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      if (j.model === "none") throw new Error("No dealer here sells that yet. Try a Terra Hybrid, Terra Compact, Lumen Sedan or Haul Pickup.");
      const pre: Partial<Profile> = {}; Object.entries(j.answered ?? {}).forEach(([k, v]) => { if (v) pre[k as keyof Profile] = String(v); });
      setParsed(j); setAnswers(pre);
    } catch (e) { setErr(String((e as Error).message)); setSent(""); }
    finally { setBusy(""); }
  }
  function answer(text: string) {
    const q = missing[0]; if (!q || !text.trim()) return;
    setAnswers((a) => ({ ...a, [q.key]: text.trim() })); setTyped("");
  }
  const createVerify = useCallback(async () => {
    const r = await fetch("/api/paypal/order", { method: "POST", body: JSON.stringify({ kind: "verify" }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error); return j.id as string;
  }, []);
  const approveVerify = useCallback(async (orderId: string) => {
    const r = await fetch("/api/paypal/verify", { method: "POST", body: JSON.stringify({ orderId }) });
    const j = await r.json(); if (!r.ok) { setErr(j.error); return; }
    setMe((m) => ({ clientId: m?.clientId ?? "", buyer: { name: j.name, email: j.email, verified: true } }));
  }, []);
  async function act(body: object) {
    setErr("");
    const r = await fetch("/api/state", { method: "POST", body: JSON.stringify({ ...body, id: reqId }) });
    const j = await r.json(); if (!r.ok) setErr(j.error ?? "Something went wrong");
    await refresh(); return r.ok;
  }
  const createDeposit = useCallback(async () => {
    const r = await fetch("/api/paypal/order", { method: "POST", body: JSON.stringify({ kind: "deposit", reqId }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error); return j.id as string;
  }, [reqId]);
  const approveDeposit = useCallback(async (orderId: string) => {
    const r = await fetch("/api/paypal/authorize", { method: "POST", body: JSON.stringify({ orderId, reqId }) });
    const j = await r.json(); if (!r.ok) setErr(j.error); await refresh();
  }, [reqId, refresh]);
  async function confirmBuy() { setBusy("Sending your gas card through PayPal"); await act({ action: "confirm" }); setBusy(""); }

  const chosen = req?.offers.find((o) => o.id === req.chosen);
  const done = !!req?.chosen;
  const reset = () => { location.href = "/"; };

  return (
    <div className={`buyer${sent ? " talking" : ""}`}>
      <div className="aurora" aria-hidden />
      <header className="top">
        <span className="brand"><i className="mark" aria-hidden />Reverso</span>
        <nav>
          {sent && <button className="link" onClick={reset}>Start over</button>}
          <span className="switch"><Link className="on" href="/">Buyer</Link><Link href="/dealer">Dealer</Link></span>
        </nav>
      </header>

      {!sent ? (
        <main className="hello">
          <h1>Which new car do you want?</h1>
          <p className="lede">Say it once. Every dealer that sells it sends their best out-the-door price. Nobody gets your number until you pick one.</p>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
            <textarea value={draft} rows={2} autoFocus aria-label="Describe the car you want" placeholder="Model, trim, how you'll pay, your city"
              onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); } }} />
            <button className="send" disabled={!draft.trim()} aria-label="Get offers">
              <svg viewBox="0 0 20 20" aria-hidden><path d="M10 16V5M5 9.5 10 4.5l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="chips">{SUGGESTIONS.map((s) => <button key={s} onClick={() => setDraft(s)}>{s}</button>)}</div>
        </main>
      ) : (
        <main className="thread">
          <p className="me">{sent}</p>
          {parsed && <Words text={`${parsed.reply} A few quick questions first, so dealers only send offers you can actually use.`} />}

          {parsed && QUESTIONS.filter((q) => answers[q.key] || q === missing[0]).map((q) => (
            <div className="qa" key={q.key}>
              <Words text={q.ask} />
              {answers[q.key] ? <p className="me">{answers[q.key]}</p> : (
                <form className="reply" onSubmit={(e) => { e.preventDefault(); answer(typed); }}>
                  {q.options.map((o) => <button type="button" key={o} onClick={() => answer(o)}>{o}</button>)}
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type your answer" aria-label={q.ask} />
                </form>
              )}
            </div>
          ))}

          {parsed && !missing.length && (
            <div className="qa">
              <Words text="Last thing: confirm it's really you. Dealers only answer verified people, and they see nothing about you until you pick an offer." />
              {verified ? (
                <p className="verified">Verified with PayPal <span>{me!.buyer!.name}, {me!.buyer!.email.replace(/^(.).*(@.*)$/, "$1•••$2")}</span></p>
              ) : (
                <div className="reply stack"><PayPalButton ready={ppReady} createOrder={createVerify} onApprove={approveVerify} onError={setErr} />
                  <small className="fine">A $1 authorization that PayPal voids at once. You are never charged.</small></div>
              )}
            </div>
          )}

          {req && <Words text="I'm asking every dealer that sells it for their best out-the-door price: taxes, fees and add-ons included. None of them gets your name or your number." />}
          {req && (
            <dl className="ask">
              <div><dt>Car</dt><dd>{req.model} {req.trim}, new</dd></div>
              <div><dt>Payment</dt><dd>{req.profile.payment}</dd></div>
              <div><dt>Pickup</dt><dd>{req.profile.city}, {req.profile.travel.toLowerCase()}</dd></div>
              <div><dt>Timing</dt><dd>{req.profile.wait}. Buying {req.profile.when.toLowerCase()}</dd></div>
              <div><dt>Budget</dt><dd>{req.profile.budget}</dd></div>
              <div><dt>Your contact</dt><dd>Verified, hidden until you pick an offer</dd></div>
            </dl>
          )}

          {(busy || (req && (req.status === "bidding" || req.status === "reviewing"))) && (
            <p className="working" role="status"><span className="orb" aria-hidden />
              <span className="shimmer">{busy || (req!.status === "bidding" ? (count ? `${count} sealed offers in. Dealers' agents are still bidding` : "Dealers' agents are preparing sealed offers") : "Reading every quote's fine print")}</span>
            </p>
          )}

          {req && count > 0 && (
            <ol className="offers">
              {req.offers.map((o, i) => {
                const open = req.chosen === o.id, passed = done && !open, settled = req.status === "open";
                return (
                  <li key={o.id} className={`offer${open ? " open" : ""}${passed ? " passed" : ""}`}>
                    <div className="who">
                      <span className="seal">
                        {!open && <svg className="lock" viewBox="0 0 16 16" aria-hidden><path d="M4 7V5a4 4 0 0 1 8 0v2h1v7H3V7h1zm2 0h4V5a2 2 0 0 0-4 0v2z" /></svg>}
                        <span className="name">{o.dealer ?? "Dealer hidden"}</span>
                      </span>
                      {i === 0 && settled && <span className="badge">Best real cost</span>}
                      {o.improved && !done && <span className="badge soft">Improved its offer</span>}
                    </div>
                    <p className="price">{usd(o.realCost)} <span className="otd">{o.realCost !== o.price ? `real cost (quoted ${usd(o.price)})` : "out the door"}</span></p>
                    <p className="perks">{o.perks}</p>
                    {o.note && <p className="note">{o.note}</p>}
                    {passed && <p className="never">Never learned who you are.</p>}
                    {!done && settled && (confirming === o.id ? (
                      <div className="confirm">
                        <p>To see who made this offer, we&apos;ll share your contact details with this dealership. Only this one.</p>
                        <button className="go" onClick={async () => { await act({ action: "choose", offer: o.id }); setConfirming(null); }}>Share my details</button>
                        <button className="link" onClick={() => setConfirming(null)}>Not yet</button>
                      </div>
                    ) : <button className="pick" onClick={() => setConfirming(o.id)}>See who this is</button>)}
                  </li>
                );
              })}
            </ol>
          )}

          {req?.status === "open" && req.summary && <Words text={req.summary} />}
          {req?.status === "failed" && <p className="error" role="alert">The auction failed: {req.error}</p>}

          {chosen && <Words text={`It's ${chosen.dealer}, ${chosen.distance} away. They have your contact now and this price is on record at ${usd(chosen.realCost)}. The other ${count - 1} dealers never learned who you are.`} />}
          {chosen && req && (
            <section className="sheet">
              <div className="photos" aria-label="The car">
                <figure className="hero-car"><img src="/car.jpg" alt={`${req.model} ${req.trim}`} /><figcaption>Illustration</figcaption></figure>
              </div>
              <dl className="ask plain">
                <div><dt>Car</dt><dd>{req.model} {req.trim}, new</dd></div>
                <div><dt>Where</dt><dd>{chosen.dealer}, {chosen.distance} away</dd></div>
                <div><dt>Price</dt><dd>{usd(chosen.realCost)} out the door</dd></div>
                <div><dt>Terms</dt><dd>{chosen.perks}</dd></div>
              </dl>
              {req.reserved ? <p className="verified">Reserved for you <span>{usd(req.deposit)} authorized with PayPal, refundable until you sign</span></p>
                : req.holdUntil && <Hold until={req.holdUntil} />}
            </section>
          )}

          {chosen && req && !req.reserved && (
            <div className="qa">
              <Words text={req.visit ? `Your visit is booked for ${req.visit}. You can still reserve it now so nobody else buys it first.` : `Want to lock it in? Reserve it with a ${usd(req.deposit)} PayPal deposit, refundable until you sign, or book a visit to see it first.`} />
              <div className="reply stack">
                <PayPalButton ready={ppReady} createOrder={createDeposit} onApprove={approveDeposit} onError={setErr} />
                {!req.visit && !booking && <button onClick={() => setBooking(true)}>Book a visit</button>}
                {!req.visit && booking && SLOTS.map((slot) => <button key={slot} onClick={() => { setBooking(false); act({ action: "visit", slot }); }}>{slot}</button>)}
              </div>
            </div>
          )}

          {req?.reserved && !req.purchased && (
            <div className="qa">
              <Words text={`Reserved. When you've signed and driven it home, tell me and Reverso sends you a ${usd(req.gasCard)} gas card through PayPal.`} />
              <div className="reply"><button className="paypal" onClick={confirmBuy} disabled={!!busy}>Yes, I bought it</button></div>
            </div>
          )}
          {req?.purchased && (
            <section className="gas">
              <p className="gas-k">Gas card</p>
              <p className="gas-v">{usd(req.gasCard)}</p>
              <p className="gas-s">Sent to {req.buyer.email} with PayPal. Enjoy the drive.</p>
            </section>
          )}

          {err && <p className="error" role="alert">{err}</p>}
          <div ref={end} />
        </main>
      )}
    </div>
  );
}
