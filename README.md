# Brunei TCG Market (One Piece first)

PWA marketplace for the Brunei One Piece Card Game community. Google login, Buy-now and Auction listings, personal inventory with reference prices, and a card catalogue. Free users sell Buy-now and buy/bid. Paid members (BND 5/month) can also sell by auction. No payments are processed on the site: buyer and seller settle on WhatsApp.

Live: https://bruneitcgmarketplace.github.io/ · Stack: Vite + vanilla JS (static front end) and Supabase (Postgres, Google auth, realtime, storage).

## Screens (bottom tabs, ideas taken from the OPTCG.BN Android app)

| Tab | What it does |
|---|---|
| Home | Collection value, listings and auctions ending soon, value by set, set completion rings, browse by set |
| Inventory | Your cards with quantity steppers, list/grid view, search, set filter, value in BND, "Sell" button, CSV export (Settings) |
| Explore | "For sale" feed (search, type, sort) and "Card sets" browser: set page, card page with all arts, price and current listings |
| Scan | Camera reads the card code (OCR via Tesseract.js, loaded on demand) or type a code; staged list, choose art, add to inventory |
| Orders | Buying (bids, purchases), Selling (needs settlement, active), Sold history with totals; WhatsApp contact, mark sold, release, strike |
| Settings | Display name, WhatsApp, membership, exchange rate override, CSV export, install hint, admin link |

Prices are Yuyutei (Japan shop) selling prices converted JPY to BND with the SGD rate (BND is pegged to SGD, source frankfurter.dev, manual override in Settings). They are a reference, not a guaranteed local value.

## Setup

1. Create a Supabase project. In the SQL Editor run, in order: `supabase/01_schema.sql`, `02_storage.sql`, `03_inventory.sql`, `04_admin.sql`.
2. Authentication, Providers, Google: add the OAuth client ID and secret and switch the provider **on**. Authentication, URL Configuration: set the Site URL and redirect URLs.
3. Copy `.env.example` to `.env` and fill in the project URL, publishable (anon) key, optional bank details and price. `npm install`, then `npm run dev`.
4. Make yourself admin after the first login: `update public.private_profiles set is_admin = true where id = (select id from auth.users where email = 'YOU@example.com');`
5. Optional: enable `pg_cron` and schedule `select public.close_ended_auctions()` every minute. Without it, auctions close whenever someone opens Home or Explore.

## Deploy

Push to `main`; `.github/workflows/deploy.yml` builds and publishes to GitHub Pages. Set the repository variables `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MEMBER_PRICE` and (when ready) `VITE_BANK_DETAILS`. After changing variables, re-run the workflow. Pages must be set to "GitHub Actions".

## Catalogue refresh

`node tools/refresh_catalog.mjs` re-scrapes Yuyutei (all sets and prices, about 2 minutes) and optcgapi.com (English names, colours) into `public/catalog.json`. Run it when a new set releases or prices drift, then commit.

## Rules enforced in the database (not the browser)

- Only members can create auctions. Bids: start price or last bid + increment, no self-bidding, 2-minute anti-sniping extension, binding wins.
- Auction end reserves the card for the highest bidder; seller marks sold, releases, or releases and gives a strike. 3 strikes block listing, buying and bidding.
- WhatsApp numbers are private; only the two parties of a reserved/sold deal can see each other's. Inventory is private to its owner. Marking a card sold deducts one copy from the seller's inventory.
- Membership: bank transfer reference, admin approves (30 days, stacks), or admin grants/revokes directly in the Admin page.

## Tests

`cd supabase/test && npm install && node schema.test.mjs` runs all four SQL files and 59 rule checks on an in-process Postgres (PGlite).

## Known gaps

- Camera scan is NOT tested on a real phone (typed codes and the code-recognition logic are tested).
- No seller ratings, push notifications, receipt upload or online payments. Bank details are not published yet.
- Catalogue images hotlink Yuyutei; sellers should upload real photos. Check image licensing before a wider launch.
- Some newest promo cards and a few new cards have no English name yet.
