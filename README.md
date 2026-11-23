# Brunei TCG Market (One Piece first)

PWA marketplace: Google login, Buy-now and Auction listings. Free users sell Buy-now and buy/bid. Paid members (BND 5/month) can also sell by auction. No payments are processed on the site: buyer and seller settle on WhatsApp.

Stack: Vite + vanilla JS (front end, static) and Supabase (Postgres, Google auth, realtime, storage).

## Setup (about 20 minutes)

1. **Supabase project**: create a free project at supabase.com (pick the Singapore region).
2. **Database**: SQL Editor, run `supabase/01_schema.sql`, then `supabase/02_storage.sql`.
3. **Google login**:
   - Google Cloud Console, APIs & Services, Credentials, create an *OAuth client ID* (Web). Add the redirect URI shown in Supabase under Authentication, Providers, Google (`https://<project>.supabase.co/auth/v1/callback`).
   - Paste the client ID and secret into the Supabase Google provider and enable it.
   - Supabase, Authentication, URL Configuration: set *Site URL* and add *Redirect URLs* for `http://localhost:5173/` and your live site URL.
4. **Keys**: copy `.env.example` to `.env`, fill in the project URL, anon key, bank details, and price. The anon key is public by design; RLS protects the data.
5. **Run**: `npm install`, then `npm run dev`.
6. **Make yourself admin** (after your first Google login), in the SQL Editor:
   `update public.private_profiles set is_admin = true where id = (select id from auth.users where email = 'YOUR_EMAIL');`
7. **Optional, auction closing every minute**: enable the `pg_cron` extension and run the `cron.schedule` line at the bottom of `01_schema.sql`. Without it, auctions close whenever anyone opens the Browse page.

## Deploy to GitHub Pages

`npm run build` creates `dist/`. Publish `dist/` with a GitHub Actions workflow (add the four `VITE_*` values as repository secrets/variables). The build uses relative paths, so a `username.github.io/repo` URL works. Add that URL to Supabase Redirect URLs.

## Rules enforced in the database (not the browser)

- Only members can create auctions. Everyone else gets "Auction listings need a paid membership".
- Bids: minimum start price or last bid + increment, no self-bidding, no bidding after the end time, bids in the last 2 minutes extend the end by 2 minutes.
- Auction end: highest bidder gets the card reserved; no bids means ended. Seller can mark sold, release, or release and give a strike. 3 strikes block listing, buying and bidding.
- WhatsApp numbers are private; only the seller and buyer of a reserved/sold deal can see each other's.
- Membership: user submits a bank transfer reference, admin approves, 30 days are added (stacks on renewal).

## Tests

`cd supabase/test && npm install && node schema.test.mjs` runs the schema and all rules on an in-process Postgres (44 checks).

## Known gaps

- UI not yet tested against a live Supabase project (needs your keys).
- Card catalog (`public/catalog.json`, 3,525 cards from the OPTCG inventory app) has Japanese names; search by card code works best. Catalog images hotlink Yuyutei; sellers should upload real photos.
- No seller ratings, email/push notifications or receipt upload yet.
