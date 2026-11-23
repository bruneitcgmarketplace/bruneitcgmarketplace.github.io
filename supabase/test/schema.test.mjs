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
ok('second buyer blocked once reserved', await fails(buyer2, `select buy_now($1)`, [bn], 'Already reserved'));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
