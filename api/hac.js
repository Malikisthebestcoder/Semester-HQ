// Reads a student's grades from Home Access Center (HAC) and copies them into Semester HQ.
// The HAC password is used once to log in. It is never stored and never logged.
const { SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SVC, HAC_BASE_URL, HAC_DATABASE } = process.env;
const rest = (path, opt = {}) => fetch(`${SB}/rest/v1/${path}`, { ...opt, headers: { apikey: SVC, "Content-Type": "application/json", Prefer: "return=minimal", ...(opt.headers || {}) } });
const strip = (s) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Reads the Classwork page: one block per class, a header like "BN8500 - 2 8TH GRADE BAND",
// "Classwork Average 100.00%", and a table of assignments (Date Due, Date Assigned, Assignment, Category, Score, Total Points).
function parse(html) {
  const out = []; let skipped = 0;
  for (const b of html.split(/<div[^>]*class="[^"]*AssignmentClass[^"]*"[^>]*>/).slice(1)) {
    const h = b.slice(0, 2500).match(/\b([A-Z]{2,4}\d{3,5})\s*-\s*(\d{1,2})\s+([^<]+?)\s*</);
    if (!h) continue;
    const avg = parseFloat((b.match(/Classwork Average\s*(?:<[^>]*>\s*)*([0-9]{1,3}(?:\.[0-9]+)?)\s*%/i) || [])[1]);
    let e = 0, p = 0;
    for (const tr of b.match(/<tr[\s\S]*?<\/tr>/g) || []) {
      const c = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
      if (c.length >= 6 && /^\d/.test(c[4]) && /^\d/.test(c[5])) { e += parseFloat(c[4]); p += parseFloat(c[5]); }
    }
    if (!(p > 0)) { skipped++; continue; }
    const useAvg = Number.isFinite(avg) && avg > 0;
    out.push({ name: strip(h[3]).slice(0, 60), period: +h[2], earned: useAvg ? avg : e, possible: useAvg ? 100 : p });
  }
  return { classes: out, skipped };
}

async function fetchGrades(user, pass) {
  const base = HAC_BASE_URL.replace(/\/+$/, ""), jar = {};
  const get = async (url, opt = {}) => {
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
    const r = await fetch(url, { redirect: "manual", ...opt, headers: { Cookie: cookie, "User-Agent": "Mozilla/5.0", ...(opt.headers || {}) } });
    for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const kv = c.split(";")[0], i = kv.indexOf("="); jar[kv.slice(0, i)] = kv.slice(i + 1); }
    return r;
  };
  let r = await get(`${base}/HomeAccess/Account/LogOn`);
  const tag = ((await r.text()).match(/<input[^>]*name="__RequestVerificationToken"[^>]*>/) || [""])[0];
  const tok = (tag.match(/value="([^"]+)"/) || [])[1];
  if (!tok) throw new Error("login_page");
  const form = new URLSearchParams({ __RequestVerificationToken: tok, SCKTY00328510CustomEnabled: "True", SCKTY00436568CustomEnabled: "True", Database: HAC_DATABASE || "10", VerificationOption: "UsernamePassword", "LogOnDetails.UserName": user, "LogOnDetails.Password": pass, tempUN: "", tempPW: "" });
  r = await get(`${base}/HomeAccess/Account/LogOn`, { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  if (r.status !== 302 || /LogOn/i.test(r.headers.get("location") || "")) throw new Error("bad_login");
  r = await get(`${base}/HomeAccess/Classes/Classwork`);
  if (r.status !== 200) throw new Error("grades_page");
  return parse(await r.text());
}

const MSG = { login_page: "Could not read your school's HAC login page. Check HAC_BASE_URL in Vercel, or your school may use Google sign-in for HAC.", bad_login: "HAC did not accept that username and password.", grades_page: "Signed in, but the Classwork page could not be opened." };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!HAC_BASE_URL) return res.status(500).json({ error: "HAC is not set up yet (HAC_BASE_URL is missing in Vercel)." });
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: req.headers.authorization || "" } });
  if (!u.ok) return res.status(401).json({ error: "Please sign in again." });
  const user = await u.json();
  const pr = await (await rest(`profiles?id=eq.${user.id}&select=under_13,parent_approved`)).json();
  if (!pr[0] || (pr[0].under_13 && !pr[0].parent_approved)) return res.status(403).json({ error: "This account is not approved yet." });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (!b.username || !b.password) return res.status(400).json({ error: "Enter your HAC username and password." });
  let result;
  try { result = await fetchGrades(b.username, b.password); } catch (e) { return res.status(400).json({ error: MSG[e.message] || "Could not reach HAC." }); }
  if (!result.classes.length) return res.status(422).json({ error: "Signed in, but no graded classes were found. The page layout may differ, so the reader needs adjusting." });
  await rest(`classes?user_id=eq.${user.id}&source=eq.hac`, { method: "DELETE" });
  await rest("classes", { method: "POST", body: JSON.stringify(result.classes.map((c) => ({ user_id: user.id, name: c.name, period: c.period, points_earned: c.earned, points_possible: c.possible, source: "hac" }))) });
  res.status(200).json({ ok: true, count: result.classes.length, skipped: result.skipped });
};

// Shared with api/hac-login.js
module.exports.fetchGrades = fetchGrades;
module.exports.MSG = MSG;
