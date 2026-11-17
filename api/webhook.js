// Stripe webhook: turns Premium on or off. Verifies Stripe's signature before trusting anything.
const crypto = require("crypto");
async function raw(req) { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c); }
async function patch(filter, data) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: k } = process.env;
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?${filter}`, {
    method: "PATCH",
    headers: { apikey: k, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(data),
  });
}
module.exports = async (req, res) => {
  const body = await raw(req), sig = req.headers["stripe-signature"] || "";
  const p = Object.fromEntries(sig.split(",").map((x) => x.split("=")));
  const exp = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${p.t}.${body}`).digest("hex");
  const ok = p.v1 && p.v1.length === exp.length && crypto.timingSafeEqual(Buffer.from(p.v1), Buffer.from(exp)) && Math.abs(Date.now() / 1000 - Number(p.t)) < 300;
  if (!ok) return res.status(400).send("bad signature");
  const ev = JSON.parse(body), o = ev.data.object;
  if (ev.type === "checkout.session.completed") await patch(`id=eq.${o.client_reference_id}`, { is_premium: true, stripe_customer_id: o.customer });
  if (ev.type === "customer.subscription.deleted") await patch(`stripe_customer_id=eq.${o.customer}`, { is_premium: false });
  res.status(200).send("ok");
};
