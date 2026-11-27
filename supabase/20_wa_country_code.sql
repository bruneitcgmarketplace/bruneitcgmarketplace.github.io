-- Auto-add Brunei country code 673 to 7-digit local WhatsApp numbers; strip 00 international prefix.
create or replace function public.set_whatsapp(p_number text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); n text := regexp_replace(coalesce(p_number,''), '[^0-9]', '', 'g');
begin
  if n like '00%' then n := substr(n, 3); end if;
  if char_length(n) = 7 then n := '673' || n; end if;
  if char_length(n) < 10 or char_length(n) > 15 then
    raise exception 'Enter a valid WhatsApp number, e.g. 8123456 or 6738123456';
  end if;
  update private_profiles set whatsapp = n where id = me;
end $$;

-- Backfill existing 7-digit numbers
update private_profiles set whatsapp = '673' || whatsapp where whatsapp ~ '^[0-9]{7}$';
