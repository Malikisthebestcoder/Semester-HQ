// Starts a Stripe Checkout session for the signed-in student (Vercel serverless function).
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const { SUPABASE_URL, SUPABASE_ANON_KEY, STRIPE_SECRET_KEY, STRIPE_PRICE_ID, SITE_URL } = process.env;
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!u.ok) return res.status(401).json({ error: "Please sign in again." });
  const user = await u.json();
  const body = new URLSearchParams({
    mode: "subscription", "line_items[0][price]": STRIPE_PRICE_ID, "line_items[0][quantity]": "1",
    success_url: `${SITE_URL}/?premium=1`, cancel_url: `${SITE_URL}/`,
    client_reference_id: user.id, customer_email: user.email,
  });
  const s = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const j = await s.json();
  if (!s.ok) return res.status(500).json({ error: "Could not start checkout." });
  res.status(200).json({ url: j.url });
};
