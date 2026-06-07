import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildAppUrl,
  buildNfcInstruction,
  buildPendingShareState,
  buildPlatformLaunchTarget,
  buildTrialMessage,
  editablePlatformSettings,
  getStoredParticipantToken,
  isPendingShareState,
  isRewardActionLink,
  isWeChatBrowser,
  normalizeLotteryDrawResult,
  renderTemplate,
  routeFromHash,
} from "./core.mjs?v=20260607-app-deeplinks";

const app = document.querySelector("#app");
const config = window.TYPECARD_CONFIG ?? {};
const defaultCardId = config.DEFAULT_CARD_ID || "table-a01";
const basePath = config.GITHUB_PAGES_BASE_PATH || "";
const configuredPublicSiteUrl = normalizePublicSiteUrl(config.PUBLIC_SITE_URL);
const appOrigin =
  configuredPublicSiteUrl ||
  window.location.origin + window.location.pathname.replace(/\/index\.html$/, "").replace(/\/$/, "");
const pendingShareStorageKey = "typecard.pendingShare.v1";
let customerReturnCleanup = null;
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

  const queryCardId = new URLSearchParams(window.location.search).get("card") || defaultCardId;
  const authCallbackCardId = isSupabaseAuthCallbackHash(window.location.hash) ? queryCardId : "";
  if (authCallbackCardId) {
    await supabase.auth.getSession();
    cleanupAuthCallbackUrl(authCallbackCardId);
  }
  const route = authCallbackCardId
    ? `/c/${authCallbackCardId}`
    : routeFromHash(window.location.hash || `#/c/${queryCardId}`);

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

function isSupabaseAuthCallbackHash(hash) {
  return /^#(?:access_token|error|error_code)=/.test(String(hash || ""));
}

function cleanupAuthCallbackUrl(cardId) {
  const query = new URLSearchParams({ card: cardId });
  window.history.replaceState({}, document.title, `${window.location.pathname}?${query.toString()}#/c/${encodeURIComponent(cardId)}`);
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
  const { card, merchant, store, links } = bundle;
  await supabase.from("scan_events").insert({ merchant_id: card.merchant_id, card_id: card.id });

  app.innerHTML = `
    <main class="mobile-wrap">
      ${renderWeChatBrowserNotice()}
      <section class="hero">
        <div class="brand-pill">${escapeHtml(merchant.name)}</div>
        <p>${escapeHtml(store.name)}</p>
        <h1>Share and unlock rewards!</h1>
        <p>${escapeHtml(card.location)}</p>
      </section>
      <section class="task-grid">
        ${links.map(renderTaskCard).join("")}
      </section>
    </main>
  `;

  document.querySelectorAll("[data-action-id]").forEach((button) => {
    button.addEventListener("click", () => startActionFlow(bundle, button.dataset.actionId));
  });
  document.querySelectorAll("[data-open-id]").forEach((link) => {
    link.addEventListener("click", async () => {
      await recordClick(card, link.dataset.openId);
    });
  });
  bindCustomerReturnHandlers(bundle);
  restoreCompletedTask(bundle);
}

function renderTaskCard(link) {
  const canClaimReward = isRewardActionLink(link);
  return `
    <div class="task-card">
      <div class="badge" style="background:${escapeHtml(link.accent)}">${escapeHtml(link.platform.slice(0, 2).toUpperCase())}</div>
      <p class="muted">${link.category === "share" ? "Post to" : taskPrefix(link)}</p>
      <h3>${escapeHtml(link.platform)}</h3>
      ${
        canClaimReward
          ? `<button class="btn" data-action-id="${escapeHtml(link.id)}">${taskButtonText(link)}</button>`
          : `<a class="link-btn" data-open-id="${escapeHtml(link.id)}" href="${escapeAttr(link.url)}" target="_blank" rel="noopener noreferrer">${taskButtonText(link)}</a>`
      }
    </div>
  `;
}

async function startActionFlow(bundle, linkId) {
  const action = buildActionDraft(bundle, linkId);
  if (!action) return;

  savePendingShare(action.card.id, action.link.id);
  const copyPromise = copyShareText(action.copy);
  const inWeChat = isWeChatBrowser(window.navigator.userAgent);
  const launchState = inWeChat
    ? { launched: false, appAttempted: false, blockedByWeChat: true }
    : launchPlatform(action);

  const copied = await copyPromise;
  await recordClick(action.card, action.link.id);

  if (launchState.blockedByWeChat) {
    showWeChatBrowserModal();
    return;
  }

  const pending = readPendingShare();
  if (isPendingShareState(pending, action.card.id) && pending.leftAt) {
    updatePendingShare(action.card.id, { taskCompletedAt: Date.now() });
    showTaskCompleteModal(action);
    return;
  }

  showPlatformOpenedModal(action, { copied, launched: launchState.launched });
}

function buildActionDraft(bundle, linkId) {
  const { card, merchant, store, reward, links } = bundle;
  const link = links.find((candidate) => candidate.id === linkId);
  if (!link) return null;
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
  const launchTarget = buildPlatformLaunchTarget(link);

  return { card, reward, link, copy, launchTarget };
}

function showPlatformOpenedModal(action, state = {}) {
  const { link, copy } = action;
  const modalTitle = `${link.platform} ${state.copied ? "文案已复制" : "已打开"}`;
  const actionHint =
    link.category === "share"
      ? "请在 App 内完成发布。发布完成后切回这个页面，我们会自动继续抽奖流程。"
      : "请在 App 内完成评价、关注或联系。完成后切回这个页面，我们会自动继续抽奖流程。";
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `
    <div class="modal-card">
      <h2>${escapeHtml(modalTitle)}</h2>
      <p class="status-ok">${escapeHtml(actionHint)}</p>
      <div class="copy-box">${escapeHtml(copy)}</div>
      <div class="grid cols-2" style="margin-top:14px">
        <button class="btn secondary" data-copy>再复制一次</button>
        <button class="btn secondary" data-platform-open>重新打开平台</button>
      </div>
      <button class="btn secondary" data-close style="width:100%; margin-top:10px">关闭</button>
    </div>
  `;
  document.body.append(modal);

  modal.querySelector("[data-copy]").addEventListener("click", async () => {
    await copyShareText(copy);
  });
  modal.querySelector("[data-platform-open]").addEventListener("click", async () => {
    if (isWeChatBrowser(window.navigator.userAgent)) {
      showWeChatBrowserModal();
      return;
    }
    launchPlatform(action);
    await recordClick(action.card, link.id);
  });
  modal.querySelector("[data-close]").addEventListener("click", () => {
    clearPendingShare();
    modal.remove();
  });
}

function showTaskCompleteModal(action) {
  const existing = document.querySelector("[data-task-complete-modal]");
  if (existing) return;

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.dataset.taskCompleteModal = "true";
  modal.innerHTML = `
    <div class="modal-card">
      <h2>恭喜，任务完成</h2>
      <p class="status-ok">我们检测到你已经回到页面。现在可以直接参与抽奖。</p>
      <button class="btn" data-continue-lottery style="width:100%; margin-top:12px">立即抽奖</button>
    </div>
  `;
  document.body.append(modal);
  modal.querySelector("[data-continue-lottery]").addEventListener("click", () => beginLotteryFlow(action, modal));
}

async function beginLotteryFlow(action, modal) {
  modal.querySelector(".modal-card").innerHTML = `
    <h2>正在准备抽奖</h2>
    <p class="status-ok">请稍等，我们正在准备抽奖。</p>
  `;

  try {
    await showLotteryStep(action, modal);
  } catch (error) {
    showInlineModalError(modal, error.message || "抽奖准备失败，请再试一次。");
  }
}

async function showLotteryStep(action, modal) {
  const participantToken = getLotteryParticipantToken(action.card.id);
  const status = await getLotteryStatus(action.card.id, participantToken);
  if (status?.has_drawn) {
    clearPendingShare();
    showPrizeResult(modal, {
      prize_name: status.prize_name,
      prize_description: status.prize_description,
      drawn_at: status.drawn_at,
      already_drawn: true,
    });
    return;
  }

  const prizes = await loadLotteryPrizes(action.card.merchant_id);
  modal.querySelector(".modal-card").innerHTML = `
    <h2>开始抽奖</h2>
    <p class="muted">每台手机浏览器默认只能参与一次。奖品先用占位，后续按你的库存和概率替换。</p>
    <div class="lottery-grid">
      ${prizes.map(renderLotteryPrize).join("")}
    </div>
    <button class="btn" data-draw-lottery style="width:100%; margin-top:12px">立即抽奖</button>
  `;
  modal.querySelector("[data-draw-lottery]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "抽奖中...";
    try {
      const draw = await drawLottery(action.card.id, action.link.id, participantToken);
      clearPendingShare();
      showPrizeResult(modal, draw);
    } catch (error) {
      button.disabled = false;
      button.textContent = "立即抽奖";
      showInlineModalError(modal, error.message || "抽奖失败，请再试一次。");
    }
  });
}

function renderLotteryPrize(prize) {
  return `
    <div class="lottery-prize">
      <strong>${escapeHtml(prize.name)}</strong>
      <p>${escapeHtml(prize.description || "截图到店领取。")}</p>
    </div>
  `;
}

function showPrizeResult(modal, draw) {
  const alreadyText = draw.already_drawn ? "你已经参与过本次活动" : "恭喜中奖";
  modal.querySelector(".modal-card").innerHTML = `
    <p class="muted">${escapeHtml(alreadyText)}</p>
    <h1 style="text-align:center; font-size:34px; margin:12px 0">${escapeHtml(draw.prize_name)}</h1>
    <p class="status-ok">${escapeHtml(draw.prize_description || "请截图保存，到店出示给店员领取奖品。")}</p>
    <p class="muted" style="text-align:center">请截图这个页面，到店凭截图领取奖品。</p>
    <button class="btn secondary" data-close style="width:100%; margin-top:12px">我已截图</button>
  `;
  modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
}

function buildCustomerAuthRedirectUrl(cardId) {
  return `${appOrigin}/?card=${encodeURIComponent(cardId)}`;
}

function getLotteryParticipantToken(cardId) {
  return getStoredParticipantToken(window.localStorage, cardId, () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `participant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  });
}

function normalizePublicSiteUrl(url) {
  if (!url) return "";
  return String(url).trim().replace(/\/index\.html$/, "").replace(/\/$/, "");
}

function renderWeChatBrowserNotice() {
  if (!isWeChatBrowser(window.navigator.userAgent)) return "";

  return `
    <section class="wechat-notice">
      <strong>请使用系统浏览器打开</strong>
      <p>微信内置浏览器无法稳定唤起小红书、TikTok、Instagram 等 App。请点右上角“…”选择在 Safari 或 Chrome 打开。</p>
    </section>
  `;
}

function showWeChatBrowserModal() {
  const existing = document.querySelector("[data-wechat-modal]");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.dataset.wechatModal = "true";
  modal.innerHTML = `
    <div class="modal-card">
      <h2>请在系统浏览器打开</h2>
      <p class="status-warn">微信内置浏览器不能稳定打开第三方 App。请点右上角“…”选择在 Safari 或 Chrome 打开，再继续发布/评价。</p>
      <button class="btn" data-close style="width:100%; margin-top:12px">知道了</button>
    </div>
  `;
  document.body.append(modal);
  modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
}

function showInlineModalError(modal, message) {
  const existing = modal.querySelector("[data-modal-error]");
  if (existing) existing.remove();

  const errorBox = document.createElement("p");
  errorBox.className = "status-warn";
  errorBox.dataset.modalError = "true";
  errorBox.textContent = message;
  modal.querySelector(".modal-card").append(errorBox);
}

function launchPlatform(action) {
  const target = action.launchTarget;
  if (target?.appUrl) {
    openAppWithFallback(target.appUrl, target.fallbackUrl, { autoFallback: target.autoFallback !== false });
    return { launched: true, appAttempted: true };
  }

  const popup = window.open(target?.fallbackUrl || target?.url || "#", "_blank", "noopener,noreferrer");
  if (!popup) {
    window.setTimeout(() => {
      window.location.href = target?.fallbackUrl || target?.url || "#";
    }, 150);
  }

  return { launched: Boolean(popup), appAttempted: false };
}

function openAppWithFallback(appUrl, fallbackUrl, options = {}) {
  const autoFallback = options.autoFallback !== false;
  let didLeavePage = false;
  const markLeave = () => {
    didLeavePage = true;
  };
  const markHidden = () => {
    if (document.hidden) markLeave();
  };

  document.addEventListener("visibilitychange", markHidden, { once: true });
  window.addEventListener("pagehide", markLeave, { once: true });
  window.location.href = appUrl;

  if (!autoFallback) return;

  window.setTimeout(() => {
    document.removeEventListener("visibilitychange", markHidden);
    window.removeEventListener("pagehide", markLeave);
    if (!didLeavePage) {
      window.location.href = fallbackUrl;
    }
  }, 1800);
}

function savePendingShare(cardId, linkId) {
  try {
    window.sessionStorage?.setItem(
      pendingShareStorageKey,
      JSON.stringify(buildPendingShareState({ cardId, linkId })),
    );
  } catch {
    // Storage can be unavailable in strict private browsers; the flow still works without resume.
  }
}

function updatePendingShare(cardId, patch) {
  const pending = readPendingShare();
  if (!isPendingShareState(pending, cardId)) return null;
  const next = { ...pending, ...patch };
  try {
    window.sessionStorage?.setItem(pendingShareStorageKey, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
  return next;
}

function readPendingShare() {
  try {
    return JSON.parse(window.sessionStorage?.getItem(pendingShareStorageKey) || "null");
  } catch {
    return null;
  }
}

function clearPendingShare() {
  try {
    window.sessionStorage?.removeItem(pendingShareStorageKey);
  } catch {
    // Ignore storage cleanup failures.
  }
}

function bindCustomerReturnHandlers(bundle) {
  if (customerReturnCleanup) customerReturnCleanup();

  const markLeft = () => {
    updatePendingShare(bundle.card.id, { leftAt: Date.now() });
  };
  const handleReturn = () => {
    window.setTimeout(() => restoreCompletedTask(bundle), 150);
  };
  const handleVisibility = () => {
    if (document.hidden) {
      markLeft();
    } else {
      handleReturn();
    }
  };

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pagehide", markLeft);
  window.addEventListener("pageshow", handleReturn);
  window.addEventListener("focus", handleReturn);

  customerReturnCleanup = () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("pagehide", markLeft);
    window.removeEventListener("pageshow", handleReturn);
    window.removeEventListener("focus", handleReturn);
  };
}

function restoreCompletedTask(bundle) {
  const pending = readPendingShare();
  if (!isPendingShareState(pending, bundle.card.id)) return;
  if (document.querySelector("[data-task-complete-modal]")) return;
  const returnedFromApp =
    Boolean(pending.leftAt || pending.taskCompletedAt) || Date.now() - pending.createdAt > 2500;
  if (!returnedFromApp) return;

  const action = buildActionDraft(bundle, pending.linkId);
  if (!action) {
    clearPendingShare();
    return;
  }

  const completedAt = pending.taskCompletedAt || Date.now();
  updatePendingShare(bundle.card.id, { taskCompletedAt: completedAt });
  document.querySelectorAll(".modal").forEach((modal) => modal.remove());
  showTaskCompleteModal(action);
}

async function copyShareText(copy) {
  try {
    await navigator.clipboard?.writeText(copy);
    return true;
  } catch {
    return false;
  }
}

async function recordClick(card, linkId) {
  await supabase.from("click_events").insert({
    merchant_id: card.merchant_id,
    card_id: card.id,
    link_id: linkId,
  });
}

async function getLotteryStatus(cardId, participantToken) {
  const { data, error } = await supabase.rpc("get_lottery_status_public", {
    p_card_id: cardId,
    p_participant_token: participantToken,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function loadLotteryPrizes(merchantId) {
  const { data, error } = await supabase
    .from("lottery_prizes")
    .select("id,name,description")
    .eq("merchant_id", merchantId)
    .eq("enabled", true)
    .order("sort_order", { ascending: true })
    .limit(3);
  if (error) throw error;
  return data?.length
    ? data
    : [
        { name: "占位奖品 A", description: "截图到店领取。" },
        { name: "占位奖品 B", description: "截图到店领取。" },
        { name: "占位奖品 C", description: "截图到店领取。" },
      ];
}

async function drawLottery(cardId, linkId, participantToken) {
  const { data, error } = await supabase.rpc("draw_lottery_public", {
    p_card_id: cardId,
    p_task_link_id: linkId,
    p_participant_token: participantToken,
  });
  if (error) throw error;
  const draw = normalizeLotteryDrawResult(data);
  if (!draw) throw new Error("抽奖已完成，但返回数据异常。请刷新页面后重试。");
  return draw;
}

function renderClaim() {
  const query = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const code = query.get("code") || "TC------";
  renderClaimCode(code);
}

function renderClaimCode(code) {
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
  const card = cards?.[0];
  const { data: links, error: linksError } = card
    ? await supabase
        .from("action_links")
        .select("*")
        .eq("card_id", card.id)
        .order("sort_order", { ascending: true })
    : { data: [], error: null };
  if (linksError) throw linksError;

  return {
    user: auth.user,
    merchant,
    store: stores?.[0],
    cards: cards ?? [],
    links: links ?? [],
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
  const linksById = Object.fromEntries(bundle.links.map((link) => [link.id, link]));
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
          <section class="settings-section">
            <h2>平台入口</h2>
            <p class="muted">这里控制顾客页出现哪些平台，以及每个平台点开后去哪里。</p>
            ${editablePlatformSettings
              .map((platform) => renderPlatformLinkSetting(platform, linksById[platform.id]))
              .join("")}
          </section>
          <section class="settings-section">
            <h2>平台文案</h2>
            <p class="muted">发布类平台会自动生成文案；评价/关注类平台可以写给顾客看的提示。</p>
            ${editablePlatformSettings
              .map((platform) => renderPlatformTemplateSetting(platform, reward))
              .join("")}
            <label class="field">默认文案 <textarea class="textarea" name="template-default">${escapeHtml(reward?.publish_templates?.default || "")}</textarea></label>
          </section>
          <button class="btn">保存设置</button>
        </form>
      </section>
    </main>
  `;

  document.querySelector("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const publishTemplates = editablePlatformSettings.reduce(
      (templates, platform) => ({
        ...templates,
        [platform.id]: String(form.get(`template-${platform.id}`) || ""),
      }),
      {
        ...(reward.publish_templates || {}),
        default: String(form.get("template-default") || ""),
      },
    );
    const linkUpdates = editablePlatformSettings
      .filter((platform) => linksById[platform.id])
      .map((platform) =>
        supabase
          .from("action_links")
          .update({
            label: String(form.get(`link-${platform.id}-label`) || platform.linkLabel),
            url: String(form.get(`link-${platform.id}-url`) || linksById[platform.id].url),
            enabled: form.has(`link-${platform.id}-enabled`),
          })
          .eq("card_id", linksById[platform.id].card_id)
          .eq("id", platform.id),
      );
    const [{ error: merchantError }, { error: rewardError }, ...linkResults] = await Promise.all([
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
      ...linkUpdates,
    ]);
    const linkError = linkResults.find((result) => result.error)?.error;
    if (merchantError || rewardError || linkError) {
      alert(merchantError?.message || rewardError?.message || linkError?.message);
      return;
    }
    alert("已保存");
  });
}

function renderPlatformLinkSetting(platform, link) {
  const enabled = link?.enabled ?? true;
  return `
    <div class="platform-setting">
      <div class="platform-setting-head">
        <strong>${escapeHtml(platform.name)}</strong>
        <label class="toggle-field">
          <input type="checkbox" name="link-${escapeAttr(platform.id)}-enabled" ${enabled ? "checked" : ""} />
          显示入口
        </label>
      </div>
      <label class="field">按钮标题 <input class="input" name="link-${escapeAttr(platform.id)}-label" value="${escapeAttr(link?.label || platform.linkLabel)}" /></label>
      <label class="field">平台链接 <input class="input" name="link-${escapeAttr(platform.id)}-url" value="${escapeAttr(link?.url || "")}" placeholder="https://" /></label>
    </div>
  `;
}

function renderPlatformTemplateSetting(platform, reward) {
  return `
    <label class="field">${escapeHtml(platform.templateLabel)}
      <textarea class="textarea" name="template-${escapeAttr(platform.id)}">${escapeHtml(reward?.publish_templates?.[platform.id] || "")}</textarea>
    </label>
  `;
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
  const nfcInstruction = buildNfcInstruction(url);

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
          <div class="print-card-hero">
            <p>Scan or Tap</p>
            <h1>Get Your Reward</h1>
          </div>
          <div class="print-entry-grid">
            <div class="nfc-panel">
              <div class="nfc-phone">
                <span></span>
                <strong>NFC</strong>
              </div>
              <p>Tap your phone here</p>
            </div>
            <div class="or-divider">or</div>
            <div class="qr-panel">
              <img alt="二维码" src="${escapeAttr(qrUrl)}" width="190" height="190" />
              <p>Scan QR code</p>
            </div>
          </div>
          <div class="print-card-footer">
            <h2>${escapeHtml(bundle.merchant.name)}</h2>
            <p>${escapeHtml(bundle.store.name)} · ${escapeHtml(bundle.card.location)}</p>
            <p class="muted" style="word-break:break-all">${escapeHtml(url)}</p>
            <p class="nfc-instruction">${escapeHtml(nfcInstruction)}</p>
          </div>
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
