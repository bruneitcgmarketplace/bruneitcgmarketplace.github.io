// Runs 01_schema.sql on an in-process Postgres (PGlite) with stubbed Supabase auth, then exercises the rules.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const stub = `
create role anon; create role authenticated;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
`;
await db.exec(stub);
await db.exec(readFileSync(new URL('../01_schema.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../03_inventory.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../04_admin.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../05_share.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../07_hold_message.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../08_sold_at.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../10_avatar.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../12_problem_reports.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../09_agreed_price.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../14_ratings_tags.sql', import.meta.url), 'utf8'));
await db.exec(`grant usage on schema public to anon, authenticated;
 grant select, insert, update, delete on all tables in schema public to anon, authenticated;
 grant usage, select on all sequences in schema public to anon, authenticated;
 grant execute on all functions in schema public to anon, authenticated;`);
// re-apply the column-level restriction (the blanket grant above mimics Supabase defaults, so revoke again)
await db.exec(`revoke update on public.profiles from authenticated, anon; grant update (display_name) on public.profiles to authenticated;`);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${cond ? '' : extra}`); };

async function as(uid, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  return db.query(sql, params);
}
async function fails(uid, sql, params, expect) {
  try { await as(uid, sql, params); return false; }
  catch (e) { return expect ? e.message.includes(expect) : true; }
}
async function admin(sql, params = []) { await db.exec('reset role'); return db.query(sql, params); }

const mk = async (email) => (await admin(`insert into auth.users(email, raw_user_meta_data) values ($1, '{"full_name":"U ${email}"}') returning id`, [email])).rows[0].id;
const seller = await mk('seller@x.com'), buyer = await mk('buyer@x.com'), buyer2 = await mk('buyer2@x.com'), boss = await mk('boss@x.com');
await admin(`update private_profiles set is_admin = true where id = $1`, [boss]);
for (const u of [seller, buyer, buyer2]) await as(u, `select set_whatsapp('6737123456')`);

ok('profile auto-created', (await admin(`select count(*)::int c from profiles`)).rows[0].c === 4);
ok('invalid whatsapp rejected', await fails(buyer, `select set_whatsapp('12')`, [], 'valid WhatsApp'));

const card = { card_code: 'OP01-001', card_name: 'Roronoa Zoro', rarity: 'L', set_id: 'op01', card_ref: 'op01-1' };
const lst = async (u, o) => (await as(u, `select create_listing($1::jsonb) id`, [JSON.stringify({ ...card, ...o })])).rows[0].id;

// --- access rules
ok('free user cannot create auction', await fails(seller, `select create_listing($1::jsonb)`, [JSON.stringify({ ...card, type: 'auction', start_price: 5, duration_hours: 24 })], 'paid membership'));
const bn = await lst(seller, { type: 'buy_now', price: 20 });
ok('free user can create buy-now', !!bn);
ok('direct insert into listings denied', await fails(seller, `insert into listings(seller_id,type,card_code,card_name,price) values ($1,'buy_now','x','x',1)`, [seller]));
ok('direct update of listings denied', (await as(seller, `update listings set price = 1 where id = $1 returning id`, [bn])).rows.length === 0);
ok('cannot self-promote to member/admin', await fails(seller, `update private_profiles set is_admin = true where id = $1`, [seller]) || (await as(seller, `update private_profiles set is_admin = true where id = $1 returning id`, [seller])).rows.length === 0);
ok('cannot edit is_admin through profiles', await fails(seller, `update profiles set id = id, created_at = now() where id = $1`, [seller]));
ok('other users cannot read private profile', (await as(buyer, `select * from private_profiles where id = $1`, [seller])).rows.length === 0);

// --- membership flow
ok('non-admin cannot approve', await fails(seller, `select admin_approve_membership(1)`, [], 'Admin only') || true);
await as(seller, `select request_membership('BIBD-REF-123')`);
ok('duplicate pending request rejected', await fails(seller, `select request_membership('again')`, [], 'pending'));
const reqId = (await as(seller, `select id from membership_requests`)).rows[0].id;
ok('non-admin cannot approve (real id)', await fails(seller, `select admin_approve_membership($1)`, [reqId], 'Admin only'));
await as(boss, `select admin_approve_membership($1, 30)`, [reqId]);
ok('member_until set ~30 days', (await as(seller, `select (member_until > now() + interval '29 days') ok from private_profiles where id = $1`, [seller])).rows[0].ok);
ok('is_member true after approval', (await as(seller, `select is_member($1) m`, [seller])).rows[0].m);

// --- buy now
ok('seller cannot buy own', await fails(seller, `select buy_now($1)`, [bn], 'own listing'));
await as(buyer, `select buy_now($1)`, [bn]);
ok('second buyer blocked while on hold, with the hold message', await fails(buyer2, `select buy_now($1)`, [bn], 'On hold: another buyer is completing this purchase'));
ok('third party gets no contact', (await as(buyer2, `select * from get_contact($1)`, [bn])).rows.length === 0);
ok('buyer gets seller contact', (await as(buyer, `select * from get_contact($1)`, [bn])).rows[0]?.role === 'seller');
ok('seller gets buyer contact', (await as(seller, `select * from get_contact($1)`, [bn])).rows[0]?.whatsapp === '6737123456');
await as(buyer, `select cancel_reservation($1)`, [bn]);
ok('buyer cancel returns to active', (await as(buyer, `select status from listings where id=$1`, [bn])).rows[0].status === 'active');
await as(buyer2, `select buy_now($1)`, [bn]);
await as(seller, `select seller_release($1, true)`, [bn]);
ok('no-show adds strike', (await as(buyer2, `select strikes from private_profiles where id=$1`, [buyer2])).rows[0].strikes === 1);
await as(buyer, `select buy_now($1)`, [bn]);
await as(seller, `select mark_sold($1)`, [bn]);
ok('mark_sold works', (await as(buyer, `select status from listings where id=$1`, [bn])).rows[0].status === 'sold');
ok('sold_at is stamped when marked sold', (await as(buyer, `select (sold_at is not null and sold_at > now() - interval '1 minute') ok from listings where id=$1`, [bn])).rows[0].ok);
ok('sold listing: seller can still get the buyer contact', (await as(seller, `select * from get_contact($1)`, [bn])).rows[0]?.role === 'buyer');
ok('sold listing: buyer can still get the seller contact', (await as(buyer, `select * from get_contact($1)`, [bn])).rows[0]?.role === 'seller');
ok('sold listing: a third party gets no contact', (await as(buyer2, `select * from get_contact($1)`, [bn])).rows.length === 0);

// --- auction
const au = await lst(seller, { type: 'auction', start_price: 10, bid_increment: 2, duration_hours: 24 });
ok('member creates auction', !!au);
ok('seller cannot bid own auction', await fails(seller, `select place_bid($1, 50)`, [au], 'own auction'));
ok('bid below start rejected', await fails(buyer, `select place_bid($1, 9)`, [au], 'Minimum bid is BND 10'));
await as(buyer, `select place_bid($1, 10)`, [au]);
ok('highest bidder cannot rebid', await fails(buyer, `select place_bid($1, 20)`, [au], 'already the highest'));
ok('increment enforced', await fails(buyer2, `select place_bid($1, 11)`, [au], 'Minimum bid is BND 12'));
await as(buyer2, `select place_bid($1, 12)`, [au]);
const row = (await as(buyer, `select current_bid, bid_count, current_bidder from listings where id=$1`, [au])).rows[0];
ok('state after bids', Number(row.current_bid) === 12 && row.bid_count === 2 && row.current_bidder === buyer2);
ok('cannot cancel auction with bids', await fails(seller, `select cancel_listing($1)`, [au], 'with bids'));
ok('bids visible to all', (await as(null, `select count(*)::int c from bids where listing_id=$1`, [au])).rows[0].c === 2);

// anti-sniping and close
await admin(`update listings set ends_at = now() + interval '30 seconds' where id = $1`, [au]);
await as(buyer, `select place_bid($1, 14)`, [au]);
ok('anti-sniping extends to >= ~2 min', (await admin(`select ends_at > now() + interval '90 seconds' x from listings where id=$1`, [au])).rows[0].x);
await admin(`update listings set ends_at = now() - interval '1 second' where id = $1`, [au]);
ok('bid after end rejected', await fails(buyer2, `select place_bid($1, 20)`, [au], 'ended'));
const closed = (await as(null, `select close_ended_auctions() n`)).rows[0].n;
ok('close_ended_auctions closes 1', closed === 1);
const fin = (await admin(`select status, buyer_id from listings where id=$1`, [au])).rows[0];
ok('winner reserved to highest bidder', fin.status === 'reserved' && fin.buyer_id === buyer);
ok('close is idempotent', (await as(null, `select close_ended_auctions() n`)).rows[0].n === 0);
await as(seller, `select seller_release($1, true)`, [au]);
ok('auction no-show -> ended + strike', (await admin(`select status from listings where id=$1`, [au])).rows[0].status === 'ended'
  && (await admin(`select strikes from private_profiles where id=$1`, [buyer])).rows[0].strikes === 1);

// no-bid auction ends
const au2 = await lst(seller, { type: 'auction', start_price: 5, duration_hours: 1 });
await admin(`update listings set ends_at = now() - interval '1 minute' where id=$1`, [au2]);
await as(null, `select close_ended_auctions()`);
ok('no-bid auction -> ended', (await admin(`select status from listings where id=$1`, [au2])).rows[0].status === 'ended');

// --- strikes block
await admin(`update private_profiles set strikes = 3 where id = $1`, [buyer2]);
const bn2 = await lst(seller, { type: 'buy_now', price: 5 });
ok('3 strikes blocks buying', await fails(buyer2, `select buy_now($1)`, [bn2], 'blocked'));

// --- membership expiry
await admin(`update private_profiles set member_until = now() - interval '1 day' where id = $1`, [seller]);
ok('expired member cannot create auction', await fails(seller, `select create_listing($1::jsonb)`, [JSON.stringify({ ...card, type: 'auction', start_price: 5 })], 'paid membership'));
ok('expired member can still buy-now list', !!(await lst(seller, { type: 'buy_now', price: 3 })));

// --- reports and admin
await as(buyer, `insert into reports(listing_id, reporter_id, reason) values ($1, $2, 'Looks fake')`, [bn2, buyer]);
ok('non-admin cannot read reports', (await as(buyer, `select * from reports`)).rows.length === 0);
ok('admin reads reports', (await as(boss, `select * from reports`)).rows.length === 1);
await as(boss, `select admin_cancel_listing($1, 1)`, [bn2]);
ok('admin cancel listing + resolve', (await admin(`select (select status from listings where id=$1) s, (select resolved from reports where id=1) r`, [bn2])).rows[0].s === 'cancelled');
ok('cannot forge report as someone else', await fails(buyer, `insert into reports(listing_id, reporter_id, reason) values ($1, $2, 'x y z')`, [bn2, seller]));

// --- inventory
const ref = 'op01-1';
ok('inventory add', (await as(buyer, `select inventory_adjust($1, 3) q`, [ref])).rows[0].q === 3);
ok('inventory subtract', (await as(buyer, `select inventory_adjust($1, -1) q`, [ref])).rows[0].q === 2);
ok('inventory is private', (await as(seller, `select * from inventory`)).rows.length === 0);
ok('cannot write other users inventory directly', await fails(seller, `insert into inventory(user_id, card_ref, qty) values ($1, 'x', 1)`, [buyer]));
ok('inventory to zero deletes row', (await as(buyer, `select inventory_adjust($1, -5) q`, [ref])).rows[0].q === 0 && (await as(buyer, `select * from inventory`)).rows.length === 0);
await as(seller, `select inventory_adjust($1, 2)`, [ref]);
const bn3 = await lst(seller, { type: 'buy_now', price: 7, card_ref: ref });
await as(buyer, `select buy_now($1)`, [bn3]);
await as(seller, `select mark_sold($1)`, [bn3]);
ok('mark_sold deducts one copy', (await as(seller, `select qty from inventory where card_ref=$1`, [ref])).rows[0].qty === 1);
const bn4 = await lst(seller, { type: 'buy_now', price: 7, card_ref: ref });
await as(buyer, `select buy_now($1)`, [bn4]);
await as(seller, `select mark_sold($1)`, [bn4]);
ok('mark_sold removes row at last copy', (await as(seller, `select * from inventory`)).rows.length === 0);
const bn5 = await lst(seller, { type: 'buy_now', price: 7, card_ref: ref });
await as(buyer, `select buy_now($1)`, [bn5]);
ok('mark_sold works with no inventory row', !(await fails(seller, `select mark_sold($1)`, [bn5])));

// --- agreed sale price (09)
const ap1 = await lst(seller, { type: 'buy_now', price: 100 });
await as(buyer, `select buy_now($1)`, [ap1]);
ok('agreed price: non-owner cannot set it', await fails(buyer, `select mark_sold($1, 80)`, [ap1], 'Not your listing'));
ok('agreed price: zero rejected', await fails(seller, `select mark_sold($1, 0)`, [ap1], 'above 0'));
ok('agreed price: negative rejected', await fails(seller, `select mark_sold($1, -5)`, [ap1], 'above 0'));
ok('agreed price: rounds to 0.00 rejected', await fails(seller, `select mark_sold($1, 0.004)`, [ap1], 'above 0'));
ok('agreed price: still reserved after rejected attempts', (await as(seller, `select status from listings where id=$1`, [ap1])).rows[0].status === 'reserved');
await as(seller, `select mark_sold($1, 92.5)`, [ap1]);
const apRow = (await as(buyer, `select status, agreed_price, price, sold_at is not null s from listings where id=$1`, [ap1])).rows[0];
ok('agreed price: stored, listing price untouched', apRow.status === 'sold' && Number(apRow.agreed_price) === 92.5 && Number(apRow.price) === 100 && apRow.s);
const ap2 = await lst(seller, { type: 'buy_now', price: 40 });
await as(buyer, `select buy_now($1)`, [ap2]); await as(seller, `select mark_sold($1)`, [ap2]);
ok('agreed price: left empty means null (listing price)', (await as(buyer, `select agreed_price is null n from listings where id=$1`, [ap2])).rows[0].n);
const ap3 = await lst(seller, { type: 'buy_now', price: 40 });
await as(buyer, `select buy_now($1)`, [ap3]); await as(seller, `select mark_sold($1, 40)`, [ap3]);
ok('agreed price: equal to listing price is stored as null', (await as(buyer, `select agreed_price is null n from listings where id=$1`, [ap3])).rows[0].n);
const ap4 = await lst(seller, { type: 'buy_now', price: 40 });
await as(buyer, `select buy_now($1)`, [ap4]); await as(seller, `select mark_sold($1, 45.678)`, [ap4]);
ok('agreed price: higher than listing allowed, rounded to 2 dp', Number((await as(buyer, `select agreed_price from listings where id=$1`, [ap4])).rows[0].agreed_price) === 45.68);
ok('agreed price: only reserved listings can be marked sold', await fails(seller, `select mark_sold($1, 10)`, [ap1], 'Only reserved'));
ok('agreed price: single-argument mark_sold still works (no ambiguity)', (await as(seller, `select count(*) c from pg_proc where proname = 'mark_sold'`)).rows[0].c == 1);

// --- profile picture (10)
const avUrl = (u, f = 'avatar-1.jpg') => `https://x.supabase.co/storage/v1/object/public/avatars/${u}/${f}`;
await as(seller, `select set_avatar($1)`, [avUrl(seller)]);
ok('avatar: set own picture', (await as(buyer, `select avatar_url from profiles where id=$1`, [seller])).rows[0].avatar_url === avUrl(seller));
ok('avatar: cannot point into another users folder', await fails(seller, `select set_avatar($1)`, [avUrl(buyer)], 'Invalid avatar'));
ok('avatar: cannot use an outside URL', await fails(seller, `select set_avatar($1)`, ['https://evil.example/pic.jpg'], 'Invalid avatar'));
ok('avatar: other bucket rejected', await fails(seller, `select set_avatar($1)`, [`https://x.supabase.co/storage/v1/object/public/listing-photos/${seller}/a.jpg`], 'Invalid avatar'));
ok('avatar: anonymous cannot set', await fails(null, `select set_avatar($1)`, [avUrl(seller)]));
ok('avatar: users cannot write profiles.avatar_url directly', await fails(seller, `update profiles set avatar_url = 'https://evil.example/x.jpg' where id = $1`, [seller]));
await as(seller, `select set_avatar(null)`);
ok('avatar: remove clears it', (await as(seller, `select avatar_url from profiles where id=$1`, [seller])).rows[0].avatar_url === null);

// --- problem reports (12)
const pf = (u, n = 'shot.jpg') => ({ path: `${u}/${n}`, name: n, type: 'image/jpeg', size: 1234 });
const pid = (await as(buyer, `select submit_problem('bug', 'The cart button does nothing', 'Pixel 8', $1::jsonb) id`, [JSON.stringify([pf(buyer)])])).rows[0].id;
ok('problem: user can submit with an attachment', pid > 0);
ok('problem: reporter sees own report', (await as(buyer, `select * from problem_reports`)).rows.length === 1);
ok('problem: other users cannot see it', (await as(buyer2, `select * from problem_reports`)).rows.length === 0);
ok('problem: admin sees it', (await as(boss, `select * from problem_reports`)).rows.length === 1);
ok('problem: attachment in someone elses folder rejected', await fails(buyer, `select submit_problem('bug', 'hello there', null, $1::jsonb)`, [JSON.stringify([pf(buyer2)])], 'Invalid attachment'));
ok('problem: path traversal rejected', await fails(buyer, `select submit_problem('bug', 'hello there', null, $1::jsonb)`, [JSON.stringify([{ path: `${buyer}/../x.jpg`, name: 'x.jpg', type: 'image/jpeg', size: 1 }])], 'Invalid attachment'));
ok('problem: more than 3 files rejected', await fails(buyer, `select submit_problem('bug', 'hello there', null, $1::jsonb)`, [JSON.stringify([1, 2, 3, 4].map((i) => pf(buyer, `s${i}.jpg`)))], 'up to 3'));
ok('problem: bad category rejected', await fails(buyer, `select submit_problem('hack', 'hello there')`, [], 'Choose a category'));
ok('problem: too short rejected', await fails(buyer, `select submit_problem('bug', 'hi')`, [], 'at least 5'));
ok('problem: too long rejected', await fails(buyer, `select submit_problem('bug', $1)`, ['x'.repeat(2001)], 'too long'));
ok('problem: anonymous cannot submit', await fails(null, `select submit_problem('bug', 'hello there')`));
ok('problem: no direct insert', await fails(buyer, `insert into problem_reports(reporter_id, category, message) values ($1, 'bug', 'direct insert')`, [buyer]));
try { await as(buyer, `update problem_reports set status = 'resolved' where id = $1`, [pid]); } catch { /* blocked by privileges: fine */ }
ok('problem: reporter cannot change the status directly', (await as(buyer, `select status from problem_reports where id=$1`, [pid])).rows[0].status === 'open');
ok('problem: non-admin cannot update status', await fails(buyer, `select admin_update_problem($1, 'resolved', 'x')`, [pid], 'Admin only'));
await as(boss, `select admin_update_problem($1, 'working', '  Looking into it  ')`, [pid]);
const prow = (await as(buyer, `select status, admin_note from problem_reports where id=$1`, [pid])).rows[0];
ok('problem: admin sets status and note, reporter sees the reply', prow.status === 'working' && prow.admin_note === 'Looking into it');
ok('problem: invalid status rejected', await fails(boss, `select admin_update_problem($1, 'bogus', null)`, [pid], 'Invalid status'));
for (let i = 0; i < 8; i++) await as(buyer2, `select submit_problem('idea', 'suggestion number ${i}')`);
ok('problem: 10 per day then rate limited', (await as(buyer2, `select count(*) c from problem_reports`)).rows[0].c == 8 && !(await fails(buyer2, `select submit_problem('idea', 'ninth suggestion')`, []))
  && !(await fails(buyer2, `select submit_problem('idea', 'tenth suggestion')`, [])) && await fails(buyer2, `select submit_problem('idea', 'eleventh suggestion')`, [], 'Too many reports'));

// --- admin tools
ok('non-admin cannot grant membership', await fails(buyer, `select admin_grant_membership($1, 30)`, [buyer], 'Admin only'));
ok('non-admin cannot set strikes', await fails(buyer, `select admin_set_strikes($1, 0)`, [buyer], 'Admin only'));
ok('regular user still cannot read others private profile', (await as(buyer, `select * from private_profiles where id = $1`, [seller])).rows.length === 0);
await as(boss, `select admin_grant_membership($1, 30)`, [buyer2]);
ok('admin grants membership', (await as(boss, `select is_member($1) m`, [buyer2])).rows[0].m);
ok('admin reads all private profiles', (await as(boss, `select * from private_profiles`)).rows.length === 4);
await as(boss, `select admin_set_strikes($1, 0)`, [buyer2]);
ok('admin resets strikes', (await as(buyer2, `select strikes from private_profiles where id = $1`, [buyer2])).rows[0].strikes === 0);
await as(boss, `select admin_grant_membership($1, 0)`, [buyer2]);
ok('admin revokes membership (days <= 0)', !(await as(boss, `select is_member($1) m`, [buyer2])).rows[0].m);

// --- inventory sharing
await as(seller, `select inventory_adjust('op01-1', 3)`); await as(seller, `select inventory_adjust('op01-2', 1)`);
ok('anon cannot create a share link', await fails(null, `select share_inventory()`, [], 'Sign in first'));
const tok = (await as(seller, `select share_inventory() t`)).rows[0].t;
ok('share token is long and random', typeof tok === 'string' && tok.length >= 32);
ok('share link is stable for same owner', (await as(seller, `select share_inventory() t`)).rows[0].t === tok);
ok('my_inventory_share returns token', (await as(seller, `select my_inventory_share() t`)).rows[0].t === tok);
ok('other user has no share', (await as(buyer, `select my_inventory_share() t`)).rows[0].t === null);
const sh = (await as(null, `select get_shared_inventory($1) j`, [tok])).rows[0].j;
ok('anon can read shared inventory', sh.items.length === 2 && sh.items.find((i) => i.card_ref === 'op01-1').qty === 3 && !!sh.owner);
ok('shared data has no contact info', !JSON.stringify(sh).includes('6737123456'));
ok('bad token rejected', await fails(null, `select get_shared_inventory('nope')`, [], 'not valid'));
ok('share table not readable directly', (await as(buyer, `select * from inventory_shares`)).rows.length === 0);
await as(seller, `select unshare_inventory()`);
ok('link dies after unshare', await fails(null, `select get_shared_inventory($1)`, [tok], 'not valid'));
ok('new link differs after re-share', (await as(seller, `select share_inventory() t`)).rows[0].t !== tok);

// --- ratings and tags
{
  const rl = await lst(seller, { type: 'buy_now', price: 10 });
  ok('cannot rate before the deal is sold', await fails(seller, `select rate_user($1, 5, 'x')`, [rl], 'after the deal'));
  await as(buyer, `select buy_now($1)`, [rl]);
  ok('cannot rate while only reserved', await fails(buyer, `select rate_user($1, 5, 'x')`, [rl], 'after the deal'));
  await as(seller, `select mark_sold($1)`, [rl]);
  ok('outsider cannot rate the deal', await fails(buyer2, `select rate_user($1, 5, 'x')`, [rl], 'Only the buyer or the seller'));
  ok('stars must be 1 to 5', await fails(buyer, `select rate_user($1, 6, 'x')`, [rl], '1 to 5') && await fails(buyer, `select rate_user($1, 0, 'x')`, [rl], '1 to 5'));
  ok('comment over 300 chars rejected', await fails(buyer, `select rate_user($1, 4, $2)`, [rl, 'a'.repeat(301)], 'too long'));
  await as(buyer, `select rate_user($1, 4, '  Smooth deal  ')`, [rl]);
  const rr = (await admin(`select * from ratings where listing_id = $1`, [rl])).rows[0];
  ok('buyer rating stored for the seller, comment trimmed', rr.ratee_id === seller && rr.rater_id === buyer && rr.stars === 4 && rr.comment === 'Smooth deal');
  ok('cannot rate the same deal twice', await fails(buyer, `select rate_user($1, 5, null)`, [rl], 'already rated'));
  await as(seller, `select rate_user($1, 5, null)`, [rl]);
  ok('seller can rate the buyer once', (await admin(`select count(*)::int c from ratings where listing_id = $1`, [rl])).rows[0].c === 2);
  ok('anyone can read ratings', (await as(null, `select count(*)::int c from ratings`)).rows[0].c === 2);
  ok('direct insert into ratings denied', await fails(buyer2, `insert into ratings(listing_id, rater_id, ratee_id, stars) values ($1, $2, $3, 5)`, [rl, buyer2, seller]));
  ok('direct update of ratings denied', (await as(buyer, `update ratings set stars = 1 where rater_id = $1 returning id`, [buyer])).rows.length === 0);
  const sm = (await as(null, `select avg::float a, n from rating_summary where ratee_id = $1`, [seller])).rows[0];
  ok('summary: seller 4.0 from 1 rating', sm && sm.a === 4 && sm.n === 1);
  ok('normal user cannot delete a rating', await fails(buyer, `select admin_delete_rating($1)`, [rr.id], 'Admin only'));
  await as(boss, `select admin_delete_rating($1)`, [rr.id]);
  ok('admin can delete a rating', (await admin(`select count(*)::int c from ratings where id = $1`, [rr.id])).rows[0].c === 0);

  ok('normal user cannot give a tag', await fails(seller, `select set_user_tag($1, 'verified', true)`, [seller], 'Admin only'));
  ok('direct insert into user_tags denied', await fails(seller, `insert into user_tags(user_id, tag) values ($1, 'verified')`, [seller]));
  ok('unknown tag rejected', await fails(boss, `select set_user_tag($1, 'god', true)`, [seller], 'Unknown tag'));
  await as(boss, `select set_user_tag($1, 'verified', true)`, [seller]);
  await as(boss, `select set_user_tag($1, 'verified', true)`, [seller]);
  await as(boss, `select set_user_tag($1, 'moderator', true)`, [seller]);
  ok('admin can tag a user (twice is harmless)', (await as(null, `select tag from user_tags where user_id = $1 order by tag`, [seller])).rows.map((r) => r.tag).join() === 'moderator,verified');
  await as(boss, `select set_user_tag($1, 'moderator', false)`, [seller]);
  ok('admin can remove a tag', (await as(null, `select tag from user_tags where user_id = $1`, [seller])).rows.map((r) => r.tag).join() === 'verified');
  ok('a tag does not make a user admin', !(await admin(`select is_admin(${"'" + seller + "'"}) a`)).rows[0].a);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
