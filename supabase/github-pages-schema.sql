-- TypeCard static app schema for GitHub Pages + Supabase.
-- Run this in Supabase SQL Editor. It is intentionally self-contained.

create extension if not exists pgcrypto;

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  slug text not null unique,
  name text not null,
  tagline text not null,
  brand_color text not null default '#2563eb',
  created_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  name text not null,
  address text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tap_cards (
  id text primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  location text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.action_links (
  id text not null,
  card_id text not null references public.tap_cards(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  label text not null,
  platform text not null,
  category text not null check (category in ('share', 'review', 'follow', 'utility')),
  url text not null,
  enabled boolean not null default true,
  accent text not null default '#2563eb',
  sort_order integer not null default 100,
  primary key (card_id, id)
);

create table if not exists public.rewards (
  id text primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  title text not null,
  description text not null,
  disclaimer text not null,
  prizes text[] not null default array['钢化膜 1 张', 'Type-C 数据线优惠', '维修检测优惠'],
  publish_templates jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  card_id text not null references public.tap_cards(id) on delete cascade,
  reward_id text not null references public.rewards(id) on delete cascade,
  platform text not null,
  code text not null unique,
  status text not null default 'pending' check (status in ('pending', 'redeemed', 'rejected')),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users(id) on delete set null
);

create table if not exists public.scan_events (
  id bigint generated always as identity primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  card_id text not null references public.tap_cards(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.click_events (
  id bigint generated always as identity primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  card_id text not null references public.tap_cards(id) on delete cascade,
  link_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_merchants_owner_id on public.merchants(owner_id);
create index if not exists idx_cards_merchant_id on public.tap_cards(merchant_id);
create index if not exists idx_links_card_id on public.action_links(card_id);
create index if not exists idx_claims_merchant_id on public.reward_claims(merchant_id);
create index if not exists idx_scan_events_card_id on public.scan_events(card_id);
create index if not exists idx_click_events_card_id on public.click_events(card_id);

alter table public.merchants enable row level security;
alter table public.stores enable row level security;
alter table public.tap_cards enable row level security;
alter table public.action_links enable row level security;
alter table public.rewards enable row level security;
alter table public.reward_claims enable row level security;
alter table public.scan_events enable row level security;
alter table public.click_events enable row level security;

drop policy if exists "public can read merchant storefronts" on public.merchants;
create policy "public can read merchant storefronts"
on public.merchants for select
to anon, authenticated
using (true);

drop policy if exists "owners can update their merchant" on public.merchants;
create policy "owners can update their merchant"
on public.merchants for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "public can read stores" on public.stores;
create policy "public can read stores"
on public.stores for select
to anon, authenticated
using (true);

drop policy if exists "owners can manage stores" on public.stores;
create policy "owners can manage stores"
on public.stores for all
to authenticated
using (exists (
  select 1 from public.merchants m where m.id = stores.merchant_id and m.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.merchants m where m.id = stores.merchant_id and m.owner_id = auth.uid()
));

drop policy if exists "public can read active cards" on public.tap_cards;
create policy "public can read active cards"
on public.tap_cards for select
to anon, authenticated
using (is_active = true);

drop policy if exists "owners can manage cards" on public.tap_cards;
create policy "owners can manage cards"
on public.tap_cards for all
to authenticated
using (exists (
  select 1 from public.merchants m where m.id = tap_cards.merchant_id and m.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.merchants m where m.id = tap_cards.merchant_id and m.owner_id = auth.uid()
));

drop policy if exists "public can read enabled links" on public.action_links;
create policy "public can read enabled links"
on public.action_links for select
to anon, authenticated
using (enabled = true);

drop policy if exists "owners can manage links" on public.action_links;
create policy "owners can manage links"
on public.action_links for all
to authenticated
using (exists (
  select 1 from public.merchants m where m.id = action_links.merchant_id and m.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.merchants m where m.id = action_links.merchant_id and m.owner_id = auth.uid()
));

drop policy if exists "public can read rewards" on public.rewards;
create policy "public can read rewards"
on public.rewards for select
to anon, authenticated
using (true);

drop policy if exists "owners can manage rewards" on public.rewards;
create policy "owners can manage rewards"
on public.rewards for all
to authenticated
using (exists (
  select 1 from public.merchants m where m.id = rewards.merchant_id and m.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.merchants m where m.id = rewards.merchant_id and m.owner_id = auth.uid()
));

drop policy if exists "owners can read claims" on public.reward_claims;
create policy "owners can read claims"
on public.reward_claims for select
to authenticated
using (exists (
  select 1 from public.merchants m where m.id = reward_claims.merchant_id and m.owner_id = auth.uid()
));

drop policy if exists "owners can update claims" on public.reward_claims;
create policy "owners can update claims"
on public.reward_claims for update
to authenticated
using (exists (
  select 1 from public.merchants m where m.id = reward_claims.merchant_id and m.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.merchants m where m.id = reward_claims.merchant_id and m.owner_id = auth.uid()
));

drop policy if exists "public can create scan events" on public.scan_events;
create policy "public can create scan events"
on public.scan_events for insert
to anon, authenticated
with check (exists (
  select 1 from public.tap_cards c where c.id = scan_events.card_id and c.merchant_id = scan_events.merchant_id and c.is_active = true
));

drop policy if exists "owners can read scan events" on public.scan_events;
create policy "owners can read scan events"
on public.scan_events for select
to authenticated
using (exists (
  select 1 from public.merchants m where m.id = scan_events.merchant_id and m.owner_id = auth.uid()
));

drop policy if exists "public can create click events" on public.click_events;
create policy "public can create click events"
on public.click_events for insert
to anon, authenticated
with check (exists (
  select 1 from public.tap_cards c where c.id = click_events.card_id and c.merchant_id = click_events.merchant_id and c.is_active = true
));

drop policy if exists "owners can read click events" on public.click_events;
create policy "owners can read click events"
on public.click_events for select
to authenticated
using (exists (
  select 1 from public.merchants m where m.id = click_events.merchant_id and m.owner_id = auth.uid()
));

create or replace function public.create_reward_claim_public(
  p_card_id text,
  p_reward_id text,
  p_platform text
)
returns table(id uuid, code text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.tap_cards%rowtype;
  v_reward public.rewards%rowtype;
  v_code text;
begin
  select * into v_card from public.tap_cards where tap_cards.id = p_card_id and is_active = true;
  if not found then
    raise exception 'card_not_found';
  end if;

  select * into v_reward from public.rewards
  where rewards.id = p_reward_id and rewards.merchant_id = v_card.merchant_id;
  if not found then
    raise exception 'reward_not_found';
  end if;

  v_code := 'TC-' || upper(substr(encode(gen_random_bytes(5), 'hex'), 1, 6));

  return query
  insert into public.reward_claims (
    merchant_id,
    store_id,
    card_id,
    reward_id,
    platform,
    code
  )
  values (
    v_card.merchant_id,
    v_card.store_id,
    v_card.id,
    v_reward.id,
    coalesce(nullif(trim(p_platform), ''), 'unknown'),
    v_code
  )
  returning reward_claims.id, reward_claims.code, reward_claims.status;
end;
$$;

create or replace function public.redeem_claim_by_code(p_code text)
returns table(id uuid, code text, status text, redeemed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.reward_claims%rowtype;
begin
  select * into v_claim
  from public.reward_claims
  where upper(reward_claims.code) = upper(trim(p_code))
  and exists (
    select 1 from public.merchants m
    where m.id = reward_claims.merchant_id
    and m.owner_id = auth.uid()
  );

  if not found then
    raise exception 'claim_not_found';
  end if;

  return query
  update public.reward_claims
  set status = 'redeemed',
      redeemed_at = now(),
      redeemed_by = auth.uid()
  where reward_claims.id = v_claim.id
  returning reward_claims.id, reward_claims.code, reward_claims.status, reward_claims.redeemed_at;
end;
$$;

grant execute on function public.create_reward_claim_public(text, text, text) to anon, authenticated;
grant execute on function public.redeem_claim_by_code(text) to authenticated;
