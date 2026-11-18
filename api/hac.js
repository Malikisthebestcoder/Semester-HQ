// Reads a student's grades from Home Access Center (HAC) and copies them into Semester HQ.
// The HAC password is used once to log in. It is never stored and never logged.
const { SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SVC, HAC_BASE_URL, HAC_DATABASE } = process.env;
const rest = (path, opt = {}) => fetch(`${SB}/rest/v1/${path}`, { ...opt, headers: { apikey: SVC, "Content-Type": "application/json", Prefer: "return=minimal", ...(opt.headers || {}) } });

// Reads the Classwork page by its visible text, not by guessed CSS class names.
// Each class title looks like "BN8500 - 2 8TH GRADE BAND" and shows "Classwork Average 100.00%".
// Assignment rows read: Date Due | Date Assigned | Assignment | Category | Score | Total Points.
function pageLines(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  t = t.replace(/<\/t[dh]>/gi, " | ").replace(/<\/tr>|<\/div>|<\/p>|<\/h\d>|<\/li>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'");
  return t.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function parseResult(html) {
  const blocks = []; let cur = null;
  const header = /([A-Z]{1,4}\d{3,6})\s*-\s*(\d{1,2})\s+([^|]+?)(?:\s+Classwork Average.*)?$/i;
  for (const s of pageLines(html)) {
    const h = s.match(header);
    if (h) { cur = { name: h[3].trim(), period: +h[2], avg: null, earned: 0, possible: 0, rows: 0 }; blocks.push(cur); }
    if (!cur) continue;
    const a = s.match(/Classwork Average\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*%/i);
    if (a) cur.avg = parseFloat(a[1]);
    const c = s.split("|").map((x) => x.trim());
    if (c.length >= 6 && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c[0]) && /^\d+(\.\d+)?$/.test(c[4]) && /^\d+(\.\d+)?$/.test(c[5])) {
      cur.earned += +c[4]; cur.possible += +c[5]; cur.rows++;
    }
  }
  // Only classes with graded work. Use HAC's own average when shown, otherwise add up the scores.
  const classes = blocks.filter((b) => b.rows > 0).map((b) => {
    const useAvg = b.avg !== null;
    return { name: b.name.slice(0, 60), period: b.period, earned: useAvg ? b.avg : b.earned, possible: useAvg ? 100 : b.possible };
  });
  const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").replace(/\s+/g, " ").trim();
  return {
    classes, found: blocks.length, skipped: blocks.length - classes.length,
    title, averages: (html.match(/Classwork Average/gi) || []).length, loginForm: /LogOn/i.test(html),
  };
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
  return parseResult(await r.text());
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
  if (!result.classes.length) {
    return res.status(422).json({ error: `Signed in, but I found ${result.found} class titles with no graded work. Page title: "${result.title}". "Classwork Average" appears ${result.averages} times. Login page: ${result.loginForm ? "yes" : "no"}. Send me this message and the page source snippet.` });
  }
  await rest(`classes?user_id=eq.${user.id}&source=eq.hac`, { method: "DELETE" });
  await rest("classes", { method: "POST", body: JSON.stringify(result.classes.map((c) => ({ user_id: user.id, name: c.name, period: c.period, points_earned: c.earned, points_possible: c.possible, source: "hac" }))) });
  res.status(200).json({ ok: true, count: result.classes.length, skipped: result.skipped });
};

// Shared with api/hac-login.js
module.exports.fetchGrades = fetchGrades;
module.exports.MSG = MSG;
