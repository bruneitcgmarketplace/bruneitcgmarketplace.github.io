-- One review per transaction: ratings for several listings given in one go share a batch id.
alter table public.ratings add column batch uuid;
update public.ratings r set batch = k.b from (select rater_id, ratee_id, stars, coalesce(comment, '') c, date_trunc('minute', created_at) m, gen_random_uuid() b from public.ratings group by 1, 2, 3, 4, 5) k where k.rater_id = r.rater_id and k.ratee_id = r.ratee_id and k.stars = r.stars and k.c = coalesce(r.comment, '') and k.m = date_trunc('minute', r.created_at);
alter table public.ratings alter column batch set not null;
alter table public.ratings alter column batch set default gen_random_uuid();
create index ratings_batch_idx on public.ratings(rater_id, batch);
-- rate_user gets p_batch (default null = its own review); rating_summary counts a batch once; admin_delete_rating removes the whole batch.
