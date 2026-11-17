// Connects a student's Home Access Center (HAC) and copies their class grades into Semester HQ.
// Passwords go only to your school's HAC. They are saved (encrypted) only if the student checks "Remember".
const crypto = require("crypto");
const { SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SVC, HAC_BASE_URL, HAC_DATABASE, HAC_ENC_KEY } = process.env;
const rest = (path, opt = {}) => fetch(`${SB}/rest/v1/${path}`, { ...opt, headers: { apikey: SVC, "Content-Type": "application/json", Prefer: "return=minimal", ...(opt.headers || {}) } });
const key = () => Buffer.from(HAC_ENC_KEY, "hex");
function enc(t) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv); const ct = Buffer.concat([c.update(t, "utf8"), c.final()]); return [iv, c.getAuthTag(), ct].map((x) => x.toString("base64")).join("."); }
function dec(s) { const [iv, tag, ct] = s.split(".").map((x) => Buffer.from(x, "base64")); const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]).toString("utf8"); }

function parse(html) {
  return html.split('class="AssignmentClass"').slice(1).map((b) => {
    const head = ((b.match(/sg-header-heading[^>]*>\s*([^<]+?)\s*</) || [])[1] || "").replace(/&amp;/g, "&").trim();
    const per = (head.match(/^\S+\s*-\s*(\d{1,2})\b/) || [])[1];
    const pct = parseFloat((b.match(/lblHdrAverage[^>]*>[^0-9<]*([0-9]{1,3}(?:\.[0-9]+)?)/) || [])[1]);
    return { name: head.replace(/^\S+\s*-\s*\d*\s*/, "") || head, period: per ? +per : 0, pct };
  }).filter((c) => c.name && Number.isFinite(c.pct));
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
  r = await get(`${base}/HomeAccess/Content/Student/Assignments.aspx`);
  if (r.status !== 200) throw new Error("grades_page");
  return parse(await r.text());
}

const MSG = { login_page: "Could not read your school's HAC login page. Check HAC_BASE_URL in Vercel, or your school may use Google sign-in for HAC.", bad_login: "HAC did not accept that username and password.", grades_page: "Signed in, but the grades page could not be opened." };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!HAC_BASE_URL || !HAC_ENC_KEY) return res.status(500).json({ error: "HAC is not set up yet (HAC_BASE_URL and HAC_ENC_KEY are missing in Vercel)." });
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: req.headers.authorization || "" } });
  if (!u.ok) return res.status(401).json({ error: "Please sign in again." });
  const user = await u.json();
  const pr = await (await rest(`profiles?id=eq.${user.id}&select=under_13,parent_approved`)).json();
  if (!pr[0] || (pr[0].under_13 && !pr[0].parent_approved)) return res.status(403).json({ error: "This account is not approved yet." });
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (b.action === "forget") { await rest(`hac_credentials?user_id=eq.${user.id}`, { method: "DELETE" }); return res.status(200).json({ ok: true }); }
  let username = b.username, password = b.password;
  if (!password) {
    const c = await (await rest(`hac_credentials?user_id=eq.${user.id}&select=username,enc`)).json();
    if (!c[0]) return res.status(400).json({ error: "Enter your HAC username and password." });
    try { username = c[0].username; password = dec(c[0].enc); } catch (e) { return res.status(400).json({ error: "Saved login could not be read. Enter it again." }); }
  }
  let classes;
  try { classes = await fetchGrades(username, password); } catch (e) { return res.status(400).json({ error: MSG[e.message] || "Could not reach HAC." }); }
  if (!classes.length) return res.status(422).json({ error: "Signed in, but no classes were found. HAC's page layout may differ, so the reader needs adjusting." });
  await rest(`classes?user_id=eq.${user.id}&source=eq.hac`, { method: "DELETE" });
  await rest("classes", { method: "POST", body: JSON.stringify(classes.map((c) => ({ user_id: user.id, name: c.name.slice(0, 60), period: c.period, points_earned: c.pct, points_possible: 100, source: "hac" }))) });
  if (b.remember && b.password) await rest("hac_credentials?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ user_id: user.id, username, enc: enc(password) }) });
  res.status(200).json({ ok: true, count: classes.length });
};
