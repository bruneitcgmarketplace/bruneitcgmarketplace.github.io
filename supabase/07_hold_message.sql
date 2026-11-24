-- Buy-now hold: a second buyer sees a clear message while another buyer is completing the purchase.
-- Behaviour is unchanged (row lock + status check); only the error text differs.
create or replace function public.buy_now(p_listing uuid) returns listings
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  if (select strikes from private_profiles where id = me) >= 3 then
    raise exception 'Your account is blocked from buying (3 strikes)';
  end if;
  if (select whatsapp from private_profiles where id = me) is null then
    raise exception 'Add your WhatsApp number first so the seller can contact you';
  end if;
  select * into l from listings where id = p_listing for update;
  if not found then raise exception 'Listing not found'; end if;
  if l.type <> 'buy_now' then raise exception 'This is an auction'; end if;
  if l.seller_id = me then raise exception 'You cannot buy your own listing'; end if;
  if l.status = 'reserved' then raise exception 'On hold: another buyer is completing this purchase'; end if;
  if l.status <> 'active' then raise exception 'This card is no longer available'; end if;
  update listings set status = 'reserved', buyer_id = me where id = l.id returning * into l;
  return l;
end $$;
