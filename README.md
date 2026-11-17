# Semester HQ

Static site (index.html) + Supabase + two Vercel functions in /api. No build step.

## Deploy
1. **GitHub:** new repo (not Study Lens), upload this whole folder, keeping `api/` and `supabase/` as folders.
2. **Supabase SQL Editor:** run `supabase/schema.sql`, then `upgrade1.sql`, then `upgrade2.sql` (removes parent emails).
3. **Create your school code** (students need it to sign up):
   `insert into public.schools (name, code) values ('Your Middle School', 'PICK-A-CODE');`
4. **config.js:** paste Project URL + anon key. Never use the service role key here.
5. **Vercel:** import the repo, Framework "Other", Deploy. Then set the Supabase Site URL to your vercel.app address.
6. **Owner:** sign up, then run:
   `update public.profiles set is_owner = true, is_premium = true where id = (select id from auth.users where email = 'YOUR EMAIL');`
   Open the site and click the Owner badge: counts plus an Approve button for under-13 students (confirm parent permission first, for example with a signed form through the school).

## Stripe Premium (use test mode first)
1. Stripe: create a monthly Product/Price and copy the price ID.
2. Vercel > Settings > Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL` (your vercel.app address, no trailing slash). Redeploy.
3. Stripe > Webhooks: endpoint `https://YOUR-SITE/api/webhook`, events `checkout.session.completed` and `customer.subscription.deleted`; copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Test with card 4242 4242 4242 4242.

## Works now
Accounts with school code, under-13 parent gate, classes and points, what-if calculator, opt-in class averages (5+ students, same school/class/period), Premium via Stripe (full grade chart and other periods), owner panel.

## Not built yet
HAC sync, Google Classroom, classmate profiles.

## Home Access Center sync (upgrade3)
1. Supabase SQL Editor: run `supabase/upgrade3.sql`.
2. Vercel environment variables, then redeploy: `HAC_BASE_URL` (your HAC address with no trailing slash, e.g. https://esp-has-1.psd202.org), plus `SUPABASE_URL`, `SUPABASE_ANON_KEY` (publishable key) and `SUPABASE_SERVICE_ROLE_KEY` (secret key). `HAC_DATABASE` is optional.
3. The HAC password is used once to log in and is never stored. If your HAC uses Google sign-in, password sync cannot work.

## Sign in with HAC only (upgrade4)
1. Upload `package.json` (top level) and `api/hac-login.js`; replace `api/hac.js` and `index.html`. Run `supabase/upgrade4.sql`.
2. Vercel env var `HAC_ID_SECRET`: 64 random hex characters (Terminal: `openssl rand -hex 32`). Keep a copy; if it changes, students can't be matched to their accounts. Needs `HAC_BASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` too. Redeploy.
3. Sign in once with your HAC login and the school code, then make yourself owner:
   `update public.profiles set is_owner = true, is_premium = true where hac_username = 'your hac username in lowercase';`
4. Under-13 students show up in the Owner panel by HAC username; click Approve after you have permission.
