-- 23_notifications.sql: in-app notification inbox (bell icon). Every push event is also stored here, so people see it even without phone alerts.
create table if not exists notifications (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null default '',
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user on notifications(user_id, created_at desc);
alter table notifications enable row level security;
revoke all on notifications from anon, authenticated;
grant select on notifications to authenticated;
drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications for select to authenticated using (user_id = auth.uid());

create or replace function mark_notifications_read(p_ids bigint[] default null) returns void
language sql security definer set search_path = public as $$
  update notifications set read_at = now() where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;
create or replace function clear_notifications() returns void
language sql security definer set search_path = public as $$
  delete from notifications where user_id = auth.uid();
$$;
revoke all on function mark_notifications_read(bigint[]), clear_notifications() from public, anon;
grant execute on function mark_notifications_read(bigint[]), clear_notifications() to authenticated;

-- store the notification, then return the phone-push item (null when the user has no subscribed device)
create or replace function push_notify(p_user uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  begin   -- the inbox must never block buying or selling
    insert into notifications(user_id, title, body, url) values (p_user, p_payload->>'title', coalesce(p_payload->>'body', ''), p_payload->>'url');
    delete from notifications where user_id = p_user and id not in (select id from notifications where user_id = p_user order by created_at desc, id desc limit 100);
  exception when others then null;
  end;
  return push_item(p_user, p_payload);
end $$;
revoke all on function push_notify(uuid, jsonb) from public, anon, authenticated;

create or replace function push_listing_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare items jsonb := '[]'::jsonb; it jsonb; bname text; sname text; what text; sec text; auc boolean := new.type = 'auction';
begin
  what := trim(coalesce(new.card_code, '') || ' ' || coalesce(new.card_name, ''));
  if new.status = 'reserved' and old.status = 'active' and new.buyer_id is not null then
    select display_name into bname from profiles where id = new.buyer_id;
    bname := coalesce(bname, 'A buyer');
    it := push_notify(new.seller_id, jsonb_build_object(
      'title', case when auc then 'Auction ended with a winner' else 'A buyer clicked Buy now' end,
      'body', bname || case when auc then ' won ' else ' reserved ' end || what || '. Contact them on WhatsApp to arrange the deal.',
      'multi', bname || case when auc then ' won {n} of your auctions' else ' reserved {n} of your cards' end || '. Open My listings.',
      'url', '#/mylistings', 'tag', 'sell-' || new.buyer_id));
    if it is not null then items := items || it; end if;
    it := push_notify(new.buyer_id, jsonb_build_object(
      'title', case when auc then 'You won the auction' else 'Card reserved for you' end,
      'body', what || ' is on hold for you. Message the seller on WhatsApp to arrange payment and meet-up.',
      'multi', '{n} cards are on hold for you. Open Orders to contact the seller.',
      'url', '#/orders', 'tag', 'buy-' || new.seller_id));
    if it is not null then items := items || it; end if;
  elsif new.status = 'sold' and old.status = 'reserved' and new.buyer_id is not null then
    select display_name into sname from profiles where id = new.seller_id;
    it := push_notify(new.buyer_id, jsonb_build_object(
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
