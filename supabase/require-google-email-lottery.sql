create or replace function public.get_lottery_status_public(
  p_card_id text,
  p_participant_token text default null
)
returns table(
  has_drawn boolean,
  draw_id uuid,
  prize_name text,
  prize_description text,
  drawn_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_has_google_email boolean := false;
  v_card public.tap_cards%rowtype;
  v_draw public.lottery_draws%rowtype;
begin
  if v_user is null then
    raise exception 'google_email_required';
  end if;

  select exists(
    select 1
    from auth.users
    where id = v_user
      and nullif(trim(coalesce(email, '')), '') is not null
      and (
        raw_app_meta_data ->> 'provider' = 'google'
        or coalesce(raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
      )
  ) into v_has_google_email;

  if not v_has_google_email then
    raise exception 'google_email_required';
  end if;

  select * into v_card from public.tap_cards where tap_cards.id = p_card_id and is_active = true;
  if not found then
    raise exception 'card_not_found';
  end if;

  select * into v_draw
  from public.lottery_draws
  where lottery_draws.merchant_id = v_card.merchant_id
    and lottery_draws.user_id = v_user
  order by created_at desc
  limit 1;

  if not found then
    return query select false, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  return query select true, v_draw.id, v_draw.prize_name, v_draw.prize_description, v_draw.created_at;
end;
$$;

create or replace function public.draw_lottery_public(
  p_card_id text,
  p_task_link_id text default null,
  p_participant_token text default null
)
returns table(
  draw_id uuid,
  prize_name text,
  prize_description text,
  already_drawn boolean,
  drawn_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_has_google_email boolean := false;
  v_card public.tap_cards%rowtype;
  v_draw public.lottery_draws%rowtype;
  v_prize public.lottery_prizes%rowtype;
begin
  if v_user is null then
    raise exception 'google_email_required';
  end if;

  select exists(
    select 1
    from auth.users
    where id = v_user
      and nullif(trim(coalesce(email, '')), '') is not null
      and (
        raw_app_meta_data ->> 'provider' = 'google'
        or coalesce(raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
      )
  ) into v_has_google_email;

  if not v_has_google_email then
    raise exception 'google_email_required';
  end if;

  select * into v_card from public.tap_cards where tap_cards.id = p_card_id and is_active = true;
  if not found then
    raise exception 'card_not_found';
  end if;

  select * into v_draw
  from public.lottery_draws
  where lottery_draws.merchant_id = v_card.merchant_id
    and lottery_draws.user_id = v_user
  order by created_at desc
  limit 1;

  if found then
    return query select v_draw.id, v_draw.prize_name, v_draw.prize_description, true, v_draw.created_at;
    return;
  end if;

  insert into public.lottery_draws (
    merchant_id,
    store_id,
    card_id,
    user_id,
    participant_token_hash,
    task_link_id,
    prize_name,
    prize_description,
    status
  ) values (
    v_card.merchant_id,
    v_card.store_id,
    v_card.id,
    v_user,
    null,
    nullif(trim(coalesce(p_task_link_id, '')), ''),
    '抽奖处理中',
    '',
    'pending'
  )
  returning * into v_draw;

  select * into v_prize
  from public.lottery_prizes
  where lottery_prizes.merchant_id = v_card.merchant_id
    and lottery_prizes.enabled = true
    and lottery_prizes.stock_remaining > 0
  order by power(random(), 1.0 / probability_weight) desc, sort_order asc
  limit 1;

  if not found then
    update public.lottery_draws
    set prize_name = '谢谢参与',
        prize_description = '本次奖品已抽完，请向店员咨询其他活动。',
        status = 'won'
    where id = v_draw.id
    returning * into v_draw;
  else
    update public.lottery_prizes
    set stock_remaining = stock_remaining - 1
    where id = v_prize.id and stock_remaining > 0
    returning * into v_prize;

    update public.lottery_draws
    set prize_id = v_prize.id,
        prize_name = v_prize.name,
        prize_description = v_prize.description,
        status = 'won'
    where id = v_draw.id
    returning * into v_draw;
  end if;

  return query select v_draw.id, v_draw.prize_name, v_draw.prize_description, false, v_draw.created_at;
exception
  when unique_violation then
    select * into v_draw
    from public.lottery_draws
    where lottery_draws.merchant_id = v_card.merchant_id
      and lottery_draws.user_id = v_user
    order by created_at desc
    limit 1;

    return query select v_draw.id, v_draw.prize_name, v_draw.prize_description, true, v_draw.created_at;
end;
$$;

grant execute on function public.get_lottery_status_public(text, text) to anon, authenticated;
grant execute on function public.draw_lottery_public(text, text, text) to anon, authenticated;
