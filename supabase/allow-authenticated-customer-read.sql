alter table public.merchants enable row level security;
alter table public.stores enable row level security;
alter table public.tap_cards enable row level security;
alter table public.action_links enable row level security;
alter table public.rewards enable row level security;
alter table public.lottery_prizes enable row level security;

drop policy if exists "public can read merchant storefronts" on public.merchants;
create policy "public can read merchant storefronts"
on public.merchants for select
to anon, authenticated
using (true);

drop policy if exists "public can read stores" on public.stores;
create policy "public can read stores"
on public.stores for select
to anon, authenticated
using (true);

drop policy if exists "public can read active cards" on public.tap_cards;
create policy "public can read active cards"
on public.tap_cards for select
to anon, authenticated
using (is_active = true);

drop policy if exists "public can read enabled links" on public.action_links;
create policy "public can read enabled links"
on public.action_links for select
to anon, authenticated
using (enabled = true);

drop policy if exists "public can read rewards" on public.rewards;
create policy "public can read rewards"
on public.rewards for select
to anon, authenticated
using (true);

drop policy if exists "public can read enabled lottery prizes" on public.lottery_prizes;
create policy "public can read enabled lottery prizes"
on public.lottery_prizes for select
to anon, authenticated
using (enabled = true);
