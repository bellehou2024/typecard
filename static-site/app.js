import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAppUrl,
  buildTrialMessage,
  renderTemplate,
  routeFromHash,
} from "./core.mjs";

const app = document.querySelector("#app");
const config = window.TYPECARD_CONFIG ?? {};
const defaultCardId = config.DEFAULT_CARD_ID || "table-a01";
const basePath = config.GITHUB_PAGES_BASE_PATH || "";
const appOrigin = window.location.origin + window.location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "");
const supabase =
  config.SUPABASE_URL && config.SUPABASE_PUBLISHABLE_KEY
    ? createClient(config.SUPABASE_URL, config.SUPABASE_PUBLISHABLE_KEY)
    : null;

window.addEventListener("hashchange", render);
render();

async function render() {
  if (!supabase) {
    renderSetup();
    return;
  }

  const route = routeFromHash(window.location.hash || `#/c/${defaultCardId}`);

  try {
    if (route === "/" || route === "") {
      navigate(`/c/${defaultCardId}`);
      return;
    }
    if (route.startsWith("/c/")) {
      await renderCustomer(route.split("/")[2]);
      return;
    }
    if (route.startsWith("/claim/")) {
      renderClaim();
      return;
    }
    if (route === "/login") {
      await renderLogin();
      return;
    }
    if (route === "/dashboard") {
      await renderDashboard();
      return;
    }
    if (route === "/settings") {
      await renderSettings();
      return;
    }
    if (route === "/trial-kit") {
      await renderTrialKit();
      return;
    }
    if (route.startsWith("/print/")) {
      await renderPrint(route.split("/")[2]);
      return;
    }
    renderNotFound();
  } catch (error) {
    renderError(error);
  }
}

function navigate(route) {
  window.location.hash = route;
}

function renderSetup() {
  app.innerHTML = `
    <main class="shell">
      <section class="wrap panel">
        <h1>需要配置 Supabase</h1>
        <p class="muted">请复制 <code>static-site/config.example.js</code> 为 <code>static-site/config.js</code>，填入 Supabase URL 和 publishable key。</p>
        <p class="status-warn">GitHub Pages 发布时，GitHub Actions 会用仓库 Secrets 自动生成 config.js。</p>
      </section>
    </main>
  `;
}

async function loadCustomerBundle(cardId) {
  const { data: card, error: cardError } = await supabase
    .from("tap_cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (cardError) throw cardError;

  const [{ data: merchant, error: merchantError }, { data: store, error: storeError }] =
    await Promise.all([
      supabase.from("merchants").select("*").eq("id", card.merchant_id).single(),
      supabase.from("stores").select("*").eq("id", card.store_id).single(),
    ]);
  if (merchantError) throw merchantError;
  if (storeError) throw storeError;

  const [{ data: links, error: linksError }, { data: rewards, error: rewardsError }] =
    await Promise.all([
      supabase
        .from("action_links")
        .select("*")
        .eq("card_id", cardId)
        .eq("enabled", true)
        .order("sort_order", { ascending: true }),
      supabase.from("rewards").select("*").eq("merchant_id", card.merchant_id).limit(1),
    ]);
  if (linksError) throw linksError;
  if (rewardsError) throw rewardsError;

  return { card, merchant, store, links: links ?? [], reward: rewards?.[0] ?? null };
}

async function renderCustomer(cardId) {
  const bundle = await loadCustomerBundle(cardId);
  const { card, merchant, store, links, reward } = bundle;
  await supabase.from("scan_events").insert({ merchant_id: card.merchant_id, card_id: card.id });

  const primaryLinks = links.slice(0, 4);
  const prizes = reward?.prizes?.length
    ? reward.prizes
    : ["钢化膜 1 张", "Type-C 数据线优惠", "维修检测优惠"];

  app.innerHTML = `
    <main class="mobile-wrap">
      <section class="hero">
        <div class="brand-pill">${escapeHtml(merchant.name)}</div>
        <p>${escapeHtml(store.name)}</p>
        <h1>Share and unlock rewards!</h1>
        <p>${escapeHtml(card.location)}</p>
      </section>
      <section class="task-grid">
        ${primaryLinks.map(renderTaskCard).join("")}
      </section>
      <section class="reward-box">
        <div class="prizes">
          ${prizes
            .map(
              (prize) => `
                <div>
                  <div class="prize-img"></div>
                  <p>${escapeHtml(prize)}</p>
                </div>
              `,
            )
            .join("")}
        </div>
        <p class="muted">${escapeHtml(reward?.disclaimer || "福利用于感谢参与，不要求好评或指定内容。")}</p>
      </section>
      <section class="reward-box">
        <h2>Get more chances to draw!</h2>
        ${links.map(renderTaskRow).join("")}
      </section>
    </main>
  `;

  document.querySelectorAll("[data-share-id]").forEach((button) => {
    button.addEventListener("click", () => showShareModal(bundle, button.dataset.shareId));
  });
  document.querySelectorAll("[data-open-id]").forEach((link) => {
    link.addEventListener("click", async () => {
      await recordClick(card, link.dataset.openId);
    });
  });
}

function renderTaskCard(link) {
  const isShare = link.category === "share";
  return `
    <div class="task-card">
      <div class="badge" style="background:${escapeHtml(link.accent)}">${escapeHtml(link.platform.slice(0, 2).toUpperCase())}</div>
      <p class="muted">${isShare ? "Post to" : taskPrefix(link)}</p>
      <h3>${escapeHtml(link.platform)}</h3>
      ${
        isShare
          ? `<button class="btn" data-share-id="${escapeHtml(link.id)}">Post</button>`
          : `<a class="link-btn" data-open-id="${escapeHtml(link.id)}" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer">${taskButtonText(link)}</a>`
      }
    </div>
  `;
}

function renderTaskRow(link) {
  const isShare = link.category === "share";
  return `
    <div class="header" style="margin:12px 0">
      <div>
        <strong>${escapeHtml(link.platform)}</strong>
        <p class="muted" style="margin:4px 0">${escapeHtml(link.label)}</p>
      </div>
      ${
        isShare
          ? `<button class="btn" data-share-id="${escapeHtml(link.id)}">Post</button>`
          : `<a class="link-btn" data-open-id="${escapeHtml(link.id)}" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer">${taskButtonText(link)}</a>`
      }
    </div>
  `;
}

function showShareModal(bundle, linkId) {
  const { card, merchant, store, reward, links } = bundle;
  const link = links.find((candidate) => candidate.id === linkId);
  const template =
    reward?.publish_templates?.[link.id] ||
    reward?.publish_templates?.default ||
    "今天在 {{merchantName}} 发现了不错的手机回收、二手手机和配件服务，推荐来店里看看。";
  const copy = renderTemplate(template, {
    merchantName: merchant.name,
    storeName: store.name,
    storeAddress: store.address,
    platform: link.platform,
  });

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-card">
      <h2>${escapeHtml(link.platform)} 发布文案已生成</h2>
      <div class="copy-box">${escapeHtml(copy)}</div>
      <div class="grid cols-2" style="margin-top:14px">
        <button class="btn secondary" data-copy>复制文案</button>
        <a class="link-btn" data-platform-open href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer">打开平台</a>
      </div>
      <button class="btn" data-claim style="width:100%; margin-top:12px">已发布，生成核销码</button>
      <button class="btn secondary" data-close style="width:100%; margin-top:10px">关闭</button>
    </div>
  `;
  document.body.append(modal);

  modal.querySelector("[data-copy]").addEventListener("click", async () => {
    await navigator.clipboard?.writeText(copy);
  });
  modal.querySelector("[data-platform-open]").addEventListener("click", async () => {
    await recordClick(card, link.id);
  });
  modal.querySelector("[data-claim]").addEventListener("click", async () => {
    const claim = await createClaim(card.id, reward.id, link.id);
    modal.remove();
    navigate(`/claim/${claim.id}?code=${encodeURIComponent(claim.code)}`);
  });
  modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
}

async function recordClick(card, linkId) {
  await supabase.from("click_events").insert({
    merchant_id: card.merchant_id,
    card_id: card.id,
    link_id: linkId,
  });
}

async function createClaim(cardId, rewardId, platform) {
  const { data, error } = await supabase.rpc("create_reward_claim_public", {
    p_card_id: cardId,
    p_reward_id: rewardId,
    p_platform: platform,
  });
  if (error) throw error;
  return data[0];
}

function renderClaim() {
  const query = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const code = query.get("code") || "TC------";
  app.innerHTML = `
    <main class="shell">
      <section class="wrap panel" style="text-align:center">
        <p class="muted">福利码已生成</p>
        <h1>${escapeHtml(code)}</h1>
        <p>请把这个领取码出示给店员。店员确认后会在后台核销。</p>
        <a class="link-btn secondary" href="#/c/${escapeAttr(defaultCardId)}">返回扫码页</a>
      </section>
    </main>
  `;
}

async function renderLogin() {
  const session = await supabase.auth.getSession();
  if (session.data.session) {
    navigate("/dashboard");
    return;
  }

  app.innerHTML = `
    <main class="shell">
      <section class="wrap panel" style="max-width:460px">
        <h1>登录后台</h1>
        <form id="login-form" class="grid">
          <label class="field">邮箱 <input class="input" name="email" value="${escapeAttr(config.DEMO_LOGIN_EMAIL || "")}" required /></label>
          <label class="field">密码 <input class="input" name="password" type="password" value="${escapeAttr(config.DEMO_LOGIN_PASSWORD || "")}" required /></label>
          <button class="btn">进入后台</button>
        </form>
      </section>
    </main>
  `;

  document.querySelector("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      alert(error.message);
      return;
    }
    navigate("/dashboard");
  });
}

async function requireOwnerBundle() {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    navigate("/login");
    throw new Error("login_required");
  }

  const { data: merchant, error } = await supabase
    .from("merchants")
    .select("*")
    .eq("owner_id", auth.user.id)
    .single();
  if (error) throw error;

  const [{ data: stores }, { data: cards }, { data: rewards }, { data: claims }] =
    await Promise.all([
      supabase.from("stores").select("*").eq("merchant_id", merchant.id),
      supabase.from("tap_cards").select("*").eq("merchant_id", merchant.id),
      supabase.from("rewards").select("*").eq("merchant_id", merchant.id),
      supabase
        .from("reward_claims")
        .select("*")
        .eq("merchant_id", merchant.id)
        .order("created_at", { ascending: false }),
    ]);

  return {
    user: auth.user,
    merchant,
    store: stores?.[0],
    cards: cards ?? [],
    reward: rewards?.[0],
    claims: claims ?? [],
  };
}

async function renderDashboard() {
  const bundle = await requireOwnerBundle();
  const card = bundle.cards[0];
  app.innerHTML = `
    <main class="shell">
      <section class="wrap">
        <header class="header panel">
          <div>
            <p class="muted">TypeCard 本店管理</p>
            <h1>${escapeHtml(bundle.merchant.name)}</h1>
            <p class="muted">${escapeHtml(bundle.store?.name || "")} · ${escapeHtml(bundle.store?.address || "")}</p>
          </div>
          <div class="header-actions">
            <a class="link-btn" href="#/settings">店铺设置</a>
            <a class="link-btn secondary" href="#/trial-kit">朋友试用包</a>
            <a class="link-btn secondary" href="#/print/${escapeAttr(card?.id || defaultCardId)}">打印卡片</a>
            <button class="btn secondary" id="logout">退出</button>
          </div>
        </header>
        <section class="panel">
          <h2>线下福利核销</h2>
          <form id="redeem-form" class="grid cols-2">
            <input class="input" name="code" placeholder="输入福利码，例如 TC-ABC123" required />
            <button class="btn">立即核销</button>
          </form>
          <p id="redeem-result"></p>
        </section>
        <section class="panel" style="margin-top:16px">
          <h2>福利领取记录</h2>
          ${renderClaimsTable(bundle.claims)}
        </section>
      </section>
    </main>
  `;

  document.querySelector("#logout").addEventListener("click", async () => {
    await supabase.auth.signOut();
    navigate("/login");
  });
  document.querySelector("#redeem-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code"));
    const result = document.querySelector("#redeem-result");
    const { error } = await supabase.rpc("redeem_claim_by_code", { p_code: code });
    if (error) {
      result.className = "status-warn";
      result.textContent = "没有找到这个福利码，或它不属于当前店铺。";
      return;
    }
    result.className = "status-ok";
    result.textContent = "核销成功，后台记录已更新。";
    await renderDashboard();
  });
}

function renderClaimsTable(claims) {
  if (claims.length === 0) {
    return `<p class="muted">暂无领取记录。</p>`;
  }

  return `
    <table class="table">
      <thead><tr><th>领取码</th><th>平台</th><th>状态</th><th>时间</th></tr></thead>
      <tbody>
        ${claims
          .map(
            (claim) => `
              <tr>
                <td><strong>${escapeHtml(claim.code)}</strong></td>
                <td>${escapeHtml(claim.platform)}</td>
                <td>${claim.status === "redeemed" ? "已核销" : "待确认"}</td>
                <td>${new Date(claim.created_at).toLocaleString()}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

async function renderSettings() {
  const bundle = await requireOwnerBundle();
  const reward = bundle.reward;
  app.innerHTML = `
    <main class="shell">
      <section class="wrap panel">
        <div class="header">
          <div>
            <a href="#/dashboard">返回后台</a>
            <h1>店铺设置</h1>
          </div>
        </div>
        <form id="settings-form" class="grid">
          <label class="field">店铺名称 <input class="input" name="merchantName" value="${escapeAttr(bundle.merchant.name)}" required /></label>
          <label class="field">店铺简介 <input class="input" name="tagline" value="${escapeAttr(bundle.merchant.tagline)}" required /></label>
          <label class="field">福利标题 <input class="input" name="rewardTitle" value="${escapeAttr(reward?.title || "")}" required /></label>
          <label class="field">领取说明 <textarea class="textarea" name="rewardDescription">${escapeHtml(reward?.description || "")}</textarea></label>
          <label class="field">小红书文案 <textarea class="textarea" name="rednote">${escapeHtml(reward?.publish_templates?.rednote || "")}</textarea></label>
          <label class="field">TikTok 文案 <textarea class="textarea" name="tiktok">${escapeHtml(reward?.publish_templates?.tiktok || "")}</textarea></label>
          <button class="btn">保存设置</button>
        </form>
      </section>
    </main>
  `;

  document.querySelector("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const publishTemplates = {
      ...(reward.publish_templates || {}),
      rednote: String(form.get("rednote")),
      tiktok: String(form.get("tiktok")),
    };
    const [{ error: merchantError }, { error: rewardError }] = await Promise.all([
      supabase
        .from("merchants")
        .update({
          name: String(form.get("merchantName")),
          tagline: String(form.get("tagline")),
        })
        .eq("id", bundle.merchant.id),
      supabase
        .from("rewards")
        .update({
          title: String(form.get("rewardTitle")),
          description: String(form.get("rewardDescription")),
          publish_templates: publishTemplates,
        })
        .eq("id", reward.id),
    ]);
    if (merchantError || rewardError) {
      alert(merchantError?.message || rewardError?.message);
      return;
    }
    alert("已保存");
  });
}

async function renderTrialKit() {
  const bundle = await requireOwnerBundle();
  const cardId = bundle.cards[0]?.id || defaultCardId;
  const message = buildTrialMessage({
    appOrigin,
    basePath,
    cardId,
    merchantName: bundle.merchant.name,
    loginEmail: config.DEMO_LOGIN_EMAIL || "",
    loginPassword: config.DEMO_LOGIN_PASSWORD || "",
  });

  app.innerHTML = `
    <main class="shell">
      <section class="wrap panel">
        <div class="header">
          <div>
            <a href="#/dashboard">返回后台</a>
            <h1>朋友试用包</h1>
            <p class="muted">复制下面这段发给朋友。</p>
          </div>
          <button class="btn" id="copy-trial">复制给朋友</button>
        </div>
        <pre class="copy-box">${escapeHtml(message)}</pre>
        <label class="field" style="margin-top:14px">手动复制备用 <textarea class="textarea" readonly>${escapeHtml(message)}</textarea></label>
      </section>
    </main>
  `;

  document.querySelector("#copy-trial").addEventListener("click", async () => {
    await navigator.clipboard?.writeText(message);
    document.querySelector("#copy-trial").textContent = "已复制";
  });
}

async function renderPrint(cardId) {
  const bundle = await loadCustomerBundle(cardId);
  const url = buildAppUrl(appOrigin, basePath, `/c/${cardId}`);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(url)}`;

  app.innerHTML = `
    <main class="shell">
      <section class="wrap">
        <div class="header panel print-hide">
          <div>
            <a href="#/dashboard">返回后台</a>
            <h1>打印/下载 TypeCard</h1>
          </div>
          <button class="btn" onclick="window.print()">打印卡片</button>
        </div>
        <section class="print-card">
          <p class="muted">Scan N Get Rewards</p>
          <h1>${escapeHtml(bundle.merchant.name)}</h1>
          <p>${escapeHtml(bundle.card.location)}</p>
          <img alt="二维码" src="${escapeAttr(qrUrl)}" width="240" height="240" />
          <p>${escapeHtml(bundle.store.name)}</p>
          <p class="muted" style="word-break:break-all">${escapeHtml(url)}</p>
        </section>
      </section>
    </main>
  `;
}

function renderNotFound() {
  app.innerHTML = `<main class="shell"><section class="wrap panel"><h1>页面不存在</h1></section></main>`;
}

function renderError(error) {
  if (error.message === "login_required") return;
  if (isMissingSchemaError(error)) {
    renderSupabaseSchemaSetup(error);
    return;
  }
  app.innerHTML = `
    <main class="shell">
      <section class="wrap panel">
        <h1>出错了</h1>
        <p class="status-warn">${escapeHtml(error.message || "未知错误")}</p>
      </section>
    </main>
  `;
}

function renderSupabaseSchemaSetup(error) {
  app.innerHTML = `
    <main class="shell">
      <section class="wrap panel">
        <p class="muted">Supabase 已连接，但数据库还没初始化</p>
        <h1>请先在 Supabase 里执行建表 SQL</h1>
        <div class="setup-steps">
          <p><strong>1.</strong> 打开 Supabase 项目后台，进入 <strong>SQL Editor</strong>。</p>
          <p><strong>2.</strong> 复制并执行 <code>supabase/github-pages-schema.sql</code>。</p>
          <p><strong>3.</strong> 在 Authentication 里创建店主账号，复制这个用户的 UUID。</p>
          <p><strong>4.</strong> 把 <code>supabase/seed-demo.sql</code> 里的 <code>OWNER_USER_ID</code> 替换成店主 UUID，然后执行。</p>
          <p><strong>5.</strong> 回来刷新这个页面。</p>
        </div>
        <p class="status-warn">${escapeHtml(error.message || "Supabase schema is missing.")}</p>
      </section>
    </main>
  `;
}

function isMissingSchemaError(error) {
  return error?.code === "PGRST205" || /Could not find the table/i.test(error?.message || "");
}

function taskPrefix(link) {
  if (link.id === "google") return "Review us on";
  if (link.id === "whatsapp") return "Contact us on";
  if (link.category === "follow") return "Follow us on";
  return "Open";
}

function taskButtonText(link) {
  if (link.id === "google") return "Review";
  if (link.id === "whatsapp") return "Contact us";
  if (link.category === "follow") return "Follow";
  return "Open";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
