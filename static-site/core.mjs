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

export function renderTemplate(template, values) {
  return String(template)
    .replaceAll("{{merchantName}}", values.merchantName ?? "")
    .replaceAll("{{storeName}}", values.storeName ?? "")
    .replaceAll("{{storeAddress}}", values.storeAddress ?? "")
    .replaceAll("{{platform}}", values.platform ?? "");
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
    "3. 发布/评价后回到页面生成福利码。",
    "4. 到店出示 TC 开头的福利码，店员在后台核销。",
  ].join("\n");
}

export function routeFromHash(hash) {
  const route = String(hash || "#/").replace(/^#/, "");
  return route.startsWith("/") ? route : `/${route}`;
}
