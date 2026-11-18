// Reads a student's grades from Home Access Center (HAC) and copies them into Semester HQ.
// The HAC password is used once to log in. It is never stored and never logged.
const { SUPABASE_URL: SB, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SVC, HAC_BASE_URL, HAC_DATABASE } = process.env;
const rest = (path, opt = {}) => fetch(`${SB}/rest/v1/${path}`, { ...opt, headers: { apikey: SVC, "Content-Type": "application/json", Prefer: "return=minimal", ...(opt.headers || {}) } });

const attr = (tag, n) => {
  const m = tag.match(new RegExp("\\b" + n + '="([^"]*)"', "i"));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&") : null;
};

// Turns the page into plain lines of text, with table cells separated by " | ".
function pageLines(html) {
  let t = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  t = t.replace(/<\/t[dh]>/gi, " | ").replace(/<\/tr>|<\/div>|<\/p>|<\/h\d>|<\/li>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&#x27;/gi, "'");
  return t.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// Collects the page's hidden fields, dropdown choices, and the Refresh View button, so the form can be sent back.
function formFields(html) {
  const f = {};
  for (const t of html.match(/<input[^>]*>/gi) || []) {
    const n = attr(t, "name");
    if (n && /hidden/i.test(attr(t, "type") || "")) f[n] = attr(t, "value") || "";
  }
  for (const m of html.matchAll(/<select[^>]*>[\s\S]*?<\/select>/gi)) {
    const n = attr(m[0], "name");
    if (!n) continue;
    const opts = m[0].match(/<option[^>]*>/gi) || [];
    const pick = opts.find((o) => /selected/i.test(o)) || opts[0];
    if (pick) f[n] = attr(pick, "value") || "";
  }
  const btn = (html.match(/<input[^>]*value="Refresh View"[^>]*>/i) || [""])[0];
  if (btn && attr(btn, "name")) f[attr(btn, "name")] = "Refresh View";
  return f;
}

// Each class title looks like "BN8500 - 2 8TH GRADE BAND" and shows "Classwork Average 100.00%".
// Assignment rows read: Date Due | Date Assigned | Assignment | Category | Score | Total Points.
function parseResult(html) {
  const blocks = []; let cur = null;
  const header = /([A-Z]{1,4}\d{3,6})\s*-\s*(\d{1,2})\s+([^|]+?)(?:\s+Classwork Average.*)?$/i;
  const lines = pageLines(html);
  for (const s of lines) {
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
  const names = [...new Set((html.match(/<(?:input|select|button)[^>]*>/gi) || []).map((t) => attr(t, "name")).filter(Boolean))].slice(0, 20);
  const sample = lines.filter((s) => !/logout|home access center/i.test(s)).slice(0, 10).map((s) => s.slice(0, 60).replace(/\d{5,}/g, "#"));
  return {
    classes, found: blocks.length, skipped: blocks.length - classes.length, title, names, sample,
    averages: (html.match(/Classwork Average/gi) || []).length, tables: (html.match(/<table/gi) || []).length,
    viewstate: /__VIEWSTATE/.test(html), posted: false,
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
  const url = `${base}/HomeAccess/Classes/Classwork`;
  r = await get(url);
  if (r.status !== 200) throw new Error("grades_page");
  let html = await r.text(), out = parseResult(html);
  // If the class list is not in the first response, send the page's own form back (like pressing Refresh View).
  if (!out.classes.length && !out.found && out.viewstate) {
    r = await get(url, { method: "POST", body: new URLSearchParams(formFields(html)), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
    if (r.status === 200) { out = parseResult(await r.text()); out.posted = true; }
  }
  return out;
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
    return res.status(422).json({ error: `Signed in, but found ${result.found} class titles. Title:
