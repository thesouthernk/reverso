// PayPal REST (sandbox). Server-only: it holds the secret.
const BASE = process.env.PAYPAL_API_BASE ?? "https://api-m.sandbox.paypal.com";
const ID = process.env.PAYPAL_CLIENT_ID ?? "";
const SECRET = process.env.PAYPAL_CLIENT_SECRET ?? "";
const basic = () => "Basic " + Buffer.from(`${ID}:${SECRET}`).toString("base64");

let cached: { token: string; until: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.token;
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status}`);
  const j = await res.json();
  cached = { token: j.access_token, until: Date.now() + (j.expires_in - 60) * 1000 };
  return cached.token;
}

async function call<T = any>(method: string, path: string, body?: unknown, idem?: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await token()}`,
      "Content-Type": "application/json",
      ...(idem ? { "PayPal-Request-Id": idem } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`PayPal ${method} ${path} failed (${res.status}): ${data.message ?? data.name ?? text}`);
  return data as T;
}

const usd = (n: number) => ({ currency_code: "USD", value: n.toFixed(2) });

export const clientId = () => ID;

/** An order the buyer or dealer approves in PayPal's own window. */
export const createOrder = (intent: "CAPTURE" | "AUTHORIZE", amount: number, description: string) =>
  call<{ id: string }>("POST", "/v2/checkout/orders", {
    intent,
    purchase_units: [{ amount: usd(amount), description }],
  });

export async function captureOrder(orderId: string) {
  const o = await call<any>("POST", `/v2/checkout/orders/${orderId}/capture`, {});
  const cap = o.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap || cap.status !== "COMPLETED") throw new Error(`Capture not completed: ${cap?.status ?? o.status}`);
  return { captureId: cap.id as string, amount: Number(cap.amount.value), payer: o.payer?.email_address as string | undefined };
}

export async function authorizeOrder(orderId: string) {
  const o = await call<any>("POST", `/v2/checkout/orders/${orderId}/authorize`, {});
  const auth = o.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth || auth.status !== "CREATED") throw new Error(`Authorization not created: ${auth?.status ?? o.status}`);
  return { authorizationId: auth.id as string, amount: Number(auth.amount.value) };
}

export const voidAuthorization = (id: string) => call("POST", `/v2/payments/authorizations/${id}/void`);

export const refundCapture = (captureId: string, amount: number, note: string, idem: string) =>
  call<{ id: string; status: string }>("POST", `/v2/payments/captures/${captureId}/refund`, { amount: usd(amount), note_to_payer: note }, idem);

/** Sends money to a PayPal account by email (the gas card). */
export async function payout(email: string, amount: number, note: string, batchId: string) {
  const r = await call<any>("POST", "/v1/payments/payouts", {
    sender_batch_header: { sender_batch_id: batchId, email_subject: "Your Reverso gas card", email_message: note },
    items: [{ recipient_type: "EMAIL", amount: { value: amount.toFixed(2), currency: "USD" }, receiver: email, note, sender_item_id: batchId }],
  });
  return { batchId: r.batch_header?.payout_batch_id as string, status: r.batch_header?.batch_status as string };
}

// ---- Identity: a $1 authorization the buyer approves in PayPal, read and voided at once ----
export async function verifyByAuthorization(orderId: string) {
  const o = await call<any>("POST", `/v2/checkout/orders/${orderId}/authorize`, {});
  const auth = o.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error(`Verification not authorized: ${o.status}`);
  await voidAuthorization(auth.id); // nothing is ever charged
  const p = o.payer ?? {};
  return {
    name: [p.name?.given_name, p.name?.surname].filter(Boolean).join(" ") || "PayPal user",
    email: p.email_address as string,
    payerId: p.payer_id as string,
  };
}
