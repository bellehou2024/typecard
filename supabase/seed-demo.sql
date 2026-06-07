-- Demo seed for the GitHub Pages + Supabase static app.
-- This creates a demo owner account for local/private trials:
--   email: typecard.owner@gmail.com
--   password: demo123

do $$
declare
  v_owner uuid;
  v_owner_email text := 'typecard.owner@gmail.com';
  v_owner_password text := 'demo123';
  v_merchant uuid;
  v_store uuid;
begin
  select id into v_owner from auth.users where email = v_owner_email limit 1;

  if v_owner is null then
    v_owner := gen_random_uuid();

    insert into auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      v_owner,
      'authenticated',
      'authenticated',
      v_owner_email,
      crypt(v_owner_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      now(),
      now(),
      '',
      '',
      '',
      ''
    );

    insert into auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    values (
      gen_random_uuid(),
      v_owner,
      v_owner::text,
      jsonb_build_object('sub', v_owner::text, 'email', v_owner_email),
      'email',
      now(),
      now(),
      now()
    );
  end if;

  insert into public.merchants (owner_id, slug, name, tagline, brand_color)
  values (
    v_owner,
    'sg-phone-trade',
    'SG Phone Trade',
    '二手手机回收售卖 · 电子零部件 · 到店估价咨询',
    '#2563eb'
  )
  on conflict (slug) do update set
    owner_id = excluded.owner_id,
    name = excluded.name,
    tagline = excluded.tagline,
    brand_color = excluded.brand_color
  returning id into v_merchant;

  insert into public.stores (merchant_id, name, address)
  values (v_merchant, 'SG Phone Trade 商场店', 'Singapore Shopping Mall')
  returning id into v_store;

  insert into public.tap_cards (id, merchant_id, store_id, name, location)
  values ('table-a01', v_merchant, v_store, '柜台 TypeCard', '回收与售卖柜台')
  on conflict (id) do update set
    merchant_id = excluded.merchant_id,
    store_id = excluded.store_id,
    name = excluded.name,
    location = excluded.location,
    is_active = true;

  insert into public.rewards (
    id,
    merchant_id,
    title,
    description,
    disclaimer,
    prizes,
    publish_templates
  )
  values (
    'welcome-dessert',
    v_merchant,
    '到店专属福利',
    '完成任意平台发布或真实反馈后，到柜台出示福利码领取当日礼品。',
    '福利仅用于感谢参与和真实反馈，不要求好评或指定内容。',
    array['钢化膜 1 张', 'Type-C 数据线优惠', '维修检测优惠'],
    '{
      "rednote": "新加坡二手手机/配件店探店｜{{merchantName}}\n\n今天到 {{storeName}} 看了一下，店里可以做二手手机回收、售卖和电子零部件咨询。想换手机、卖旧机或者找配件的朋友可以来问问。\n\n#新加坡二手手机 #手机回收 #电子配件 #探店 #{{merchantName}}",
      "tiktok": "{{merchantName}} 探店分享：二手手机回收、售卖和电子配件咨询都可以到店问问。#Singapore #PhoneTradeIn #SecondHandPhone",
      "google": "请在 Google Maps 写下真实体验。发布后回到本页生成福利码，到柜台领取礼品。",
      "facebook": "关注 {{merchantName}} 的 Facebook 页面，回到本页生成福利码。",
      "instagram": "关注 {{merchantName}} 的 Instagram 页面，回到本页生成福利码。",
      "whatsapp": "通过 WhatsApp 联系 {{merchantName}} 咨询回收估价、二手机和配件。",
      "default": "今天在 {{merchantName}} 发现了不错的手机回收、二手手机和配件服务，推荐来店里看看。"
    }'::jsonb
  )
  on conflict (id) do update set
    merchant_id = excluded.merchant_id,
    title = excluded.title,
    description = excluded.description,
    disclaimer = excluded.disclaimer,
    prizes = excluded.prizes,
    publish_templates = excluded.publish_templates;

  insert into public.action_links
    (id, card_id, merchant_id, label, platform, category, url, enabled, accent, sort_order)
  values
    ('rednote', 'table-a01', v_merchant, '小红书发布探店笔记', '小红书', 'share', 'https://creator.xiaohongshu.com/publish/publish?from=typecard&target=article', true, '#ff2442', 10),
    ('tiktok', 'table-a01', v_merchant, '发布 TikTok 探店视频', 'TikTok', 'share', 'https://www.tiktok.com/', true, '#111827', 20),
    ('google', 'table-a01', v_merchant, 'Google 留下真实评价', 'Google', 'review', 'https://g.page/r/CV4dH4lr7AXnEAE/review', true, '#4285f4', 30),
    ('facebook', 'table-a01', v_merchant, '关注 Facebook', 'Facebook', 'follow', 'https://www.facebook.com/', false, '#1877f2', 40),
    ('instagram', 'table-a01', v_merchant, '关注 Instagram', 'Instagram', 'follow', 'https://www.instagram.com/', true, '#d946ef', 50),
    ('whatsapp', 'table-a01', v_merchant, 'WhatsApp 咨询报价', 'WhatsApp', 'follow', 'https://wa.me/', false, '#22c55e', 60)
  on conflict (card_id, id) do update set
    label = excluded.label,
    platform = excluded.platform,
    category = excluded.category,
    url = excluded.url,
    enabled = excluded.enabled,
    accent = excluded.accent,
    sort_order = excluded.sort_order;
end $$;
