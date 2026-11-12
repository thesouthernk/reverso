import { checkVerify, startVerify } from "@/lib/session";

const clean = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body.step === "start") {
    const name = clean(body.name, 60), email = clean(body.email, 120), phone = clean(body.phone, 30);
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || phone.replace(/\D/g, "").length < 7)
      return Response.json({ error: "Add your name, a valid email and a phone number" }, { status: 400 });
    const code = await startVerify({ name, email, phone, verified: false });
    return Response.json({ ok: true, demoCode: code });
  }
  if (body.step === "check") {
    const b = await checkVerify(clean(body.code, 10));
    return b ? Response.json({ ok: true, name: b.name, email: b.email, phone: b.phone }) : Response.json({ error: "That code doesn't match. Check it and try again." }, { status: 400 });
  }
  return Response.json({ error: "Unknown step" }, { status: 400 });
}
