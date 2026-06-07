export function normalizeBasePath(basePath = "") {
  const trimmed = String(basePath).trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}` : "";
}

export function buildAppUrl(appOrigin, basePath, route) {
  const origin = String(appOrigin).replace(/\/+$/, "");
  const normalizedBasePath = normalizeBasePath(basePath);
  const normalizedRoute = String(route).startsWith("/") ? route : `/${route}`;
  const baseSegment =
    normalizedBasePath && origin.endsWith(normalizedBasePath) ? "" : normalizedBasePath;

  return `${origin}${baseSegment}/#${normalizedRoute}`;
}

export function buildClaimRoute(claim) {
  const id = encodeURIComponent(claim?.id || "");
  const query = new URLSearchParams({ code: claim?.code || "" });
  return `/claim/${id}?${query.toString()}`;
}

export function normalizeClaimResult(result) {
  const claim = Array.isArray(result) ? result[0] : result;
  if (!claim?.id || !claim?.code) return null;
  return claim;
}

export function normalizeLotteryDrawResult(result) {
  const draw = Array.isArray(result) ? result[0] : result;
  if (!draw?.draw_id || !draw?.prize_name) return null;
  return draw;
}

export function renderTemplate(template, values) {
  return String(template)
    .replaceAll("{{merchantName}}", values.merchantName ?? "")
    .replaceAll("{{storeName}}", values.storeName ?? "")
    .replaceAll("{{storeAddress}}", values.storeAddress ?? "")
    .replaceAll("{{platform}}", values.platform ?? "");
}

export const editablePlatformSettings = [
  {
    id: "rednote",
    name: "小红书",
    linkLabel: "小红书发布探店笔记",
    templateLabel: "小红书发布文案",
  },
  {
    id: "tiktok",
    name: "TikTok",
    linkLabel: "发布 TikTok 探店视频",
    templateLabel: "TikTok 发布文案",
  },
  {
    id: "google",
    name: "Google",
    linkLabel: "Google 留下真实评价",
    templateLabel: "Google 提示文案",
  },
  {
    id: "facebook",
    name: "Facebook",
    linkLabel: "关注 Facebook",
    templateLabel: "Facebook 提示文案",
  },
  {
    id: "instagram",
    name: "Instagram",
    linkLabel: "关注 Instagram",
    templateLabel: "Instagram 提示文案",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    linkLabel: "WhatsApp 咨询报价",
    templateLabel: "WhatsApp 提示文案",
  },
];

export function buildNfcInstruction(customerUrl) {
  return `NFC 写入链接：${customerUrl}`;
}

export function buildShareLaunchUrl(link) {
  const directPublishUrls = {
    rednote: "https://creator.xiaohongshu.com/publish/publish?from=typecard&target=article",
    tiktok: "https://www.tiktok.com/",
  };

  return directPublishUrls[link?.id] || link?.url || "#";
}

function decodeBase64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(padded, "base64"));
  }

  return new Uint8Array();
}

export function extractGoogleReviewCid(url) {
  const match = String(url || "").match(/^https?:\/\/(?:www\.)?g\.page\/r\/([^/?#]+)\/review\/?/i);
  if (!match) return "";

  const bytes = decodeBase64UrlToBytes(match[1]);
  if (bytes.length < 9 || bytes[0] !== 0x09) return "";

  let cid = 0n;
  for (let index = 0; index < 8; index += 1) {
    cid += BigInt(bytes[index + 1]) << BigInt(index * 8);
  }

  return cid ? cid.toString() : "";
}

export function buildGoogleMapsLaunchTarget(reviewUrl) {
  const cid = extractGoogleReviewCid(reviewUrl);
  if (!cid) {
    return {
      appUrl: reviewUrl,
      androidAppUrl: reviewUrl,
      fallbackUrl: reviewUrl,
    };
  }

  const mapsUrl = `https://maps.google.com/?cid=${cid}`;
  return {
    appUrl: `comgooglemapsurl://maps.google.com/?cid=${cid}`,
    androidAppUrl: `intent://maps.google.com/?cid=${cid}#Intent;scheme=https;package=com.google.android.apps.maps;S.browser_fallback_url=${encodeURIComponent(reviewUrl)};end`,
    fallbackUrl: reviewUrl,
    mapsUrl,
  };
}

export function buildPlatformLaunchTarget(link) {
  const fallbackUrl = buildShareLaunchUrl(link);
  if (link?.id === "google") {
    const googleTarget = buildGoogleMapsLaunchTarget(fallbackUrl);
    return {
      url: fallbackUrl,
      appUrl: googleTarget.appUrl,
      androidAppUrl: googleTarget.androidAppUrl,
      fallbackUrl: googleTarget.fallbackUrl,
      mapsUrl: googleTarget.mapsUrl || fallbackUrl,
      prefersSameTab: true,
      autoFallback: true,
    };
  }

  const appLaunchUrls = {
    rednote: "xhsdiscover://post_note/",
    tiktok: "tiktok://",
    instagram: "instagram://camera",
    facebook: `fb://facewebmodal/f?href=${encodeURIComponent(fallbackUrl)}`,
    whatsapp: "whatsapp://send",
  };

  if (appLaunchUrls[link?.id]) {
    return {
      url: appLaunchUrls[link.id],
      appUrl: appLaunchUrls[link.id],
      fallbackUrl,
      prefersSameTab: true,
      autoFallback: false,
    };
  }

  return {
    url: fallbackUrl,
    appUrl: "",
    fallbackUrl,
    prefersSameTab: false,
    autoFallback: true,
  };
}

export function isRewardActionLink(link) {
  return ["share", "review", "follow"].includes(link?.category);
}

export function isWeChatBrowser(userAgent = "") {
  return /MicroMessenger/i.test(String(userAgent));
}

export function buildPendingShareState({ cardId, linkId, createdAt = Date.now() }) {
  return {
    cardId,
    linkId,
    createdAt,
    leftAt: null,
    taskCompletedAt: null,
  };
}

export function isPendingShareState(state, cardId) {
  return Boolean(
    state &&
      state.cardId === cardId &&
      typeof state.linkId === "string" &&
      state.linkId.length > 0 &&
      Number.isFinite(state.createdAt),
  );
}

export function getStoredParticipantToken(storage, cardId, generateToken) {
  const key = `typecard.lotteryParticipant.v1.${cardId}`;
  const existing = storage?.getItem?.(key);
  if (existing) return existing;
  const token = generateToken();
  storage?.setItem?.(key, token);
  return token;
}

export function buildTrialMessage({
  appOrigin,
  basePath = "",
  cardId,
  merchantName,
  loginEmail,
  loginPassword,
}) {
  return [
    `${merchantName} TypeCard 试用链接`,
    "",
    `顾客扫码页：${buildAppUrl(appOrigin, basePath, `/c/${cardId}`)}`,
    `二维码/打印页：${buildAppUrl(appOrigin, basePath, `/print/${cardId}`)}`,
    `后台入口：${buildAppUrl(appOrigin, basePath, "/dashboard")}`,
    "",
    `后台账号：${loginEmail}`,
    `后台密码：${loginPassword}`,
    "",
    "试用流程：",
    "1. 顾客扫二维码进入页面。",
    "2. 选择小红书、TikTok、Google、Facebook、Instagram 或 WhatsApp。",
    "3. 发布/评价后回到页面，系统弹出任务完成提示。",
    "4. 顾客完成发布/评价后直接抽奖。",
    "5. 中奖后截图，到店凭截图领取奖品。",
  ].join("\n");
}

export function routeFromHash(hash) {
  const route = String(hash || "#/").replace(/^#/, "");
  return route.startsWith("/") ? route : `/${route}`;
}
