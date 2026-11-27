-- 22_push.sql: phone notifications (Web Push). Subscriptions live here; a trigger posts to the bntcg-push Worker via pg_net.
-- The shared secret is read from Vault (name push_hook_secret), never stored in this file.
create extension if not exists pg_net;

create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on push_subscriptions(user_id, created_at desc);
alter table push_subscriptions enable row level security;
revoke all on push_subscriptions from anon, authenticated;

-- A device belongs to whoever saved it last (signing in as someone else on the same phone re-binds it).
create or replace function save_push_sub(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'Invalid notification address'; end if;
  if coalesce(length(p_p256dh), 0) not between 80 and 100 or coalesce(length(p_auth), 0) not between 16 and 40 then raise exception 'Invalid notification keys'; end if;
  insert into push_subscriptions(endpoint, user_id, p256dh, auth) values (p_endpoint, me, p_p256dh, p_auth)
    on conflict (endpoint) do update set user_id = me, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  delete from push_subscriptions where user_id = me and endpoint not in (select endpoint from push_subscriptions where user_id = me order by created_at desc limit 5);
end $$;

create or replace function delete_push_sub(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function save_push_sub(text, text, text), delete_push_sub(text) from public, anon;
grant execute on function save_push_sub(text, text, text), delete_push_sub(text) to authenticated;

-- One notification item for a user (null when that user has no subscribed device).
create or replace function push_item(p_user uuid, p_payload jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object('subs', jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)), 'payload', p_payload)
  from (select * from push_subscriptions where user_id = p_user order by created_at desc limit 5) s
  having count(*) > 0;
$$;
revoke all on function push_item(uuid, jsonb) from public, anon, authenticated;

create or replace function push_listing_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare items jsonb := '[]'::jsonb; it jsonb; bname text; sname text; what text; sec text; auc boolean := new.type = 'auction';
begin
  what := trim(coalesce(new.card_code, '') || ' ' || coalesce(new.card_name, ''));
  if new.status = 'reserved' and old.status = 'active' and new.buyer_id is not null then
    select display_name into bname from profiles where id = new.buyer_id;
    bname := coalesce(bname, 'A buyer');
    it := push_item(new.seller_id, jsonb_build_object(
      'title', case when auc then 'Auction ended with a winner' else 'A buyer clicked Buy now' end,
      'body', bname || case when auc then ' won ' else ' reserved ' end || what || '. Contact them on WhatsApp to arrange the deal.',
      'multi', bname || case when auc then ' won {n} of your auctions' else ' reserved {n} of your cards' end || '. Open My listings.',
      'url', '#/mylistings', 'tag', 'sell-' || new.buyer_id));
    if it is not null then items := items || it; end if;
    it := push_item(new.buyer_id, jsonb_build_object(
      'title', case when auc then 'You won the auction' else 'Card reserved for you' end,
      'body', what || ' is on hold for you. Message the seller on WhatsApp to arrange payment and meet-up.',
      'multi', '{n} cards are on hold for you. Open Orders to contact the seller.',
      'url', '#/orders', 'tag', 'buy-' || new.seller_id));
    if it is not null then items := items || it; end if;
  elsif new.status = 'sold' and old.status = 'reserved' and new.buyer_id is not null then
    select display_name into sname from profiles where id = new.seller_id;
    it := push_item(new.buyer_id, jsonb_build_object(
      'title', 'Marked as sold',
      'body', coalesce(sname, 'The seller') || ' marked ' || what || ' as sold. Your receipt and rating are in Orders.',
      'multi', coalesce(sname, 'The seller') || ' marked {n} of your cards as sold. Open Orders for receipts.',
      'url', '#/orders', 'tag', 'sold-' || new.seller_id));
    if it is not null then items := items || it; end if;
  end if;
  if jsonb_array_length(items) > 0 then
    begin   -- a notification problem must never block buying or selling
      select decrypted_secret into sec from vault.decrypted_secrets where name = 'push_hook_secret';
      perform net.http_post(url := 'https://bntcg-push.optcgbn.workers.dev/send', body := jsonb_build_object('items', items),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', coalesce(sec, '')));
    exception when others then null;
    end;
  end if;
  return null;
end $$;
revoke all on function push_listing_changed() from public, anon, authenticated;

drop trigger if exists listings_push on listings;
create trigger listings_push after update of status on listings
  for each row when (old.status is distinct from new.status) execute function push_listing_changed();
