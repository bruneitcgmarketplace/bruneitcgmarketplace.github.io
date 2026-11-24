-- Shared collection page: show which cards the owner has on the Marketplace, and let a signed-in visitor contact the owner.
create or replace function public.get_shared_inventory(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid; p profiles;
begin
  select user_id into uid from inventory_shares where token = p_token;
  if uid is null then raise exception 'This share link is not valid or was turned off'; end if;
  select * into p from profiles where id = uid;
  return jsonb_build_object(
    'owner', p.display_name,
    'owner_id', uid,
    'avatar', p.avatar_url,
    'items', coalesce((select jsonb_agg(jsonb_build_object('card_ref', card_ref, 'qty', qty) order by card_ref)
                         from inventory where user_id = uid), '[]'::jsonb),
    'listed', coalesce((select jsonb_object_agg(card_ref, jsonb_build_object('n', n, 'id', first_id, 'price', min_price))
                          from (select card_ref, count(*) n, (array_agg(id order by created_at, id))[1] first_id, min(price) min_price
                                  from listings where seller_id = uid and type = 'buy_now' and status = 'active' group by card_ref) g), '{}'::jsonb));
end $$;

-- The owner's WhatsApp number, for a signed-in visitor who opened the owner's share link and taps "Contact collector".
create function public.shared_contact(p_token text) returns table(display_name text, whatsapp text)
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); uid uuid; w text;
begin
  select user_id into uid from inventory_shares where token = p_token;
  if uid is null then raise exception 'This share link is not valid or was turned off'; end if;
  select pp.whatsapp into w from private_profiles pp where pp.id = uid;
  if w is null then raise exception 'This collector has not added a WhatsApp number'; end if;
  return query select p.display_name, w from profiles p where p.id = uid;
end $$;
revoke all on function public.shared_contact(text) from public, anon;
grant execute on function public.shared_contact(text) to authenticated;
