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
2. Vercel environment variables, then redeploy:
   - `HAC_BASE_URL`: your HAC login page address up to (not including) `/HomeAccess`, no trailing slash.
   - `HAC_ENC_KEY`: 64 hex characters. On a Mac, Terminal: `openssl rand -hex 32`. Keep it secret; if you lose it, saved logins can't be read.
   - `HAC_DATABASE`: optional, only if your HAC login needs a different database number than 10.
   - Also needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (see Stripe section).
3. Not guaranteed on the first try: HAC pages differ by district. If it says no classes were found, send the message back for adjusting. If your HAC uses Google sign-in, password sync cannot work.
