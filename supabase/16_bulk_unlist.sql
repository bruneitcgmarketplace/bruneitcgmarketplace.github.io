-- Unlist many of my own listings in one call. p_ids = the listings to cancel, or null = every one of my active listings.
-- Only the caller's own active listings are touched; auctions that already have bids are left alone. Returns how many were cancelled.
create function public.cancel_my_listings(p_ids uuid[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); n int;
begin
  update listings set status = 'cancelled'
   where seller_id = me and status = 'active' and (type = 'buy_now' or coalesce(bid_count, 0) = 0)
     and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
