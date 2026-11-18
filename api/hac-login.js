// Sign in with a Home Access Center (HAC) login. HAC checks the password, then we give the student a Semester HQ session.
// The HAC password is used once and never stored or logged. Accounts are keyed by a secret hash of the HAC username.
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const { fetchGrades, MSG } = require("./hac.js");
const { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SVC, HAC_BASE_URL, HAC_ID_SECRET } = process.env;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const missing = [["HAC_BASE_URL", HAC_BASE_URL], ["HAC_ID_SECRET", HAC_ID_SECRET], ["SUPABASE_URL", SB], ["SUPABASE_SERVICE_ROLE_KEY", SVC]].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return res.status(500).json({ error: `Missing in Vercel: ${missing.join(", ")}. Add them (Settings, Environment Variables, Production) and redeploy.` });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const username = String(b.username || "").trim(), password = String(b.password || "");
  if (!username || !password) return res.status(400).json({ error: "Enter your HAC username and password." });

  let result;
  try { result = await fetchGrades(username, password); } catch (e) { return res.status(400).json({ error: MSG[e.message] || "Could not reach HAC." }); }

  const admin = createClient(SB, SVC, { auth: { persistSession: false, autoRefreshToken: false } });
  const hash = crypto.createHmac("sha256", HAC_ID_SECRET).update(`${HAC_BASE_URL}|${username.toLowerCase()}`).digest("hex").slice(0, 40);
  const email = `${hash}@hac.semesterhq.app`;

  let { data: prof } = await admin.from("profiles").select("id,under_13,parent_approved").eq("hac_hash", hash).maybeSingle();
  if (!prof) {
    const code = String(b.school_code || "").trim();
    if (!code) return res.status(400).json({ error: "First time here? Enter the school code too." });
    const { data: school } = await admin.rpc("school_name", { p_code: code });
    if (!school) return res.status(400).json({ error: "That school code was not found." });
    const { data: made, error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { under_13: !!b.under_13, school_code: code } });
    if (ce || !made || !made.user) return res.status(500).json({ error: "Could not create your account. Try again." });
    await admin.from("profiles").update({ hac_hash: hash, hac_username: username.toLowerCase() }).eq("id", made.user.id);
    ({ data: prof } = await admin.from("profiles").select("id,under_13,parent_approved").eq("id", made.user.id).maybeSingle());
  }
  if (!prof) return res.status(500).json({ error: "Could not load your account. Try again." });
  if (prof.under_13 && !prof.parent_approved) return res.status(403).json({ error: "Your account is waiting to be approved. Try again after it is." });

  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (le || !link || !link.properties) return res.status(500).json({ error: "Could not start your session. Try again." });

  await admin.from("classes").delete().eq("user_id", prof.id).eq("source", "hac");
  if (result.classes.length) await admin.from("classes").insert(result.classes.map((c) => ({ user_id: prof.id, name: c.name, period: c.period, points_earned: c.earned, points_possible: c.possible, source: "hac" })));
  res.status(200).json({ ok: true, token_hash: link.properties.hashed_token, type: link.properties.verification_type || "magiclink" });
};
