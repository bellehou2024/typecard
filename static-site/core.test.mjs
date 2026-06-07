import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAppUrl,
  buildClaimRoute,
  normalizeClaimResult,
  normalizeLotteryDrawResult,
  buildNfcInstruction,
  buildPendingShareState,
  buildPlatformLaunchTarget,
  buildShareLaunchUrl,
  isPendingShareState,
  isRewardActionLink,
  isWeChatBrowser,
  editablePlatformSettings,
  buildTrialMessage,
  normalizeBasePath,
  renderTemplate,
} from "./core.mjs";

test("normalizeBasePath keeps GitHub Pages project paths predictable", () => {
  assert.equal(normalizeBasePath(""), "");
  assert.equal(normalizeBasePath("/tapcard-saas/"), "/tapcard-saas");
  assert.equal(normalizeBasePath("tapcard-saas"), "/tapcard-saas");
});

test("buildAppUrl creates hash routes for static hosting", () => {
  assert.equal(buildAppUrl("https://belle.github.io/typecard/", "", "/c/table-a01"), "https://belle.github.io/typecard/#/c/table-a01");
  assert.equal(buildAppUrl("https://belle.github.io", "/typecard", "/dashboard"), "https://belle.github.io/typecard/#/dashboard");
});

test("buildClaimRoute keeps claim code in the hash route", () => {
  assert.equal(
    buildClaimRoute({ id: "claim-123", code: "TC-ABC123" }),
    "/claim/claim-123?code=TC-ABC123",
  );
  assert.equal(
    buildClaimRoute({ id: "id with spaces", code: "TC A+B" }),
    "/claim/id%20with%20spaces?code=TC+A%2BB",
  );
});

test("normalizeClaimResult accepts Supabase RPC arrays and objects", () => {
  assert.deepEqual(normalizeClaimResult([{ id: "claim-1", code: "TC-111111" }]), {
    id: "claim-1",
    code: "TC-111111",
  });
  assert.deepEqual(normalizeClaimResult({ id: "claim-2", code: "TC-222222" }), {
    id: "claim-2",
    code: "TC-222222",
  });
  assert.equal(normalizeClaimResult([]), null);
  assert.equal(normalizeClaimResult(null), null);
});

test("normalizeLotteryDrawResult accepts Supabase draw RPC arrays and objects", () => {
  assert.deepEqual(
    normalizeLotteryDrawResult([
      {
        draw_id: "draw-1",
        prize_name: "占位奖品 A",
        prize_description: "截图到店领取",
        already_drawn: false,
      },
    ]),
    {
      draw_id: "draw-1",
      prize_name: "占位奖品 A",
      prize_description: "截图到店领取",
      already_drawn: false,
    },
  );
  assert.equal(normalizeLotteryDrawResult([]), null);
  assert.equal(normalizeLotteryDrawResult({ prize_name: "缺少 ID" }), null);
});

test("renderTemplate replaces store and platform placeholders", () => {
  const copy = renderTemplate("到 {{storeName}} 找 {{merchantName}}，发到 {{platform}}", {
    merchantName: "SG Phone Trade",
    storeName: "商场店",
    storeAddress: "Singapore",
    platform: "小红书",
  });

  assert.equal(copy, "到 商场店 找 SG Phone Trade，发到 小红书");
});

test("buildTrialMessage includes customer, admin, print links and credentials", () => {
  const message = buildTrialMessage({
    appOrigin: "https://belle.github.io/typecard",
    basePath: "/typecard",
    cardId: "table-a01",
    merchantName: "SG Phone Trade",
    loginEmail: "owner@phone.test",
    loginPassword: "demo123",
  });

  assert.match(message, /https:\/\/belle\.github\.io\/typecard\/#\/c\/table-a01/);
  assert.match(message, /https:\/\/belle\.github\.io\/typecard\/#\/dashboard/);
  assert.match(message, /https:\/\/belle\.github\.io\/typecard\/#\/print\/table-a01/);
  assert.match(message, /owner@phone\.test/);
  assert.match(message, /demo123/);
});

test("editablePlatformSettings exposes every customer platform for settings", () => {
  assert.deepEqual(
    editablePlatformSettings.map((platform) => platform.id),
    ["rednote", "tiktok", "google", "facebook", "instagram", "whatsapp"],
  );
  assert.equal(editablePlatformSettings.find((platform) => platform.id === "google").templateLabel, "Google 提示文案");
});

test("buildNfcInstruction tells merchants to write the customer URL to NFC", () => {
  const instruction = buildNfcInstruction("https://bellehou2024.github.io/typecard/#/c/table-a01");

  assert.match(instruction, /NFC/);
  assert.match(instruction, /写入/);
  assert.match(instruction, /https:\/\/bellehou2024\.github\.io\/typecard\/#\/c\/table-a01/);
});

test("buildShareLaunchUrl sends publish platforms to direct creator pages", () => {
  assert.equal(
    buildShareLaunchUrl({ id: "rednote", url: "https://www.xiaohongshu.com/" }),
    "https://creator.xiaohongshu.com/publish/publish?from=typecard&target=article",
  );
  assert.equal(
    buildShareLaunchUrl({ id: "tiktok", url: "https://www.tiktok.com/" }),
    "https://www.tiktok.com/",
  );
  assert.equal(
    buildShareLaunchUrl({ id: "google", url: "https://www.google.com/maps" }),
    "https://www.google.com/maps",
  );
});

test("buildPlatformLaunchTarget opens known app compose surfaces without web auto fallback", () => {
  const target = buildPlatformLaunchTarget({ id: "rednote", url: "https://www.xiaohongshu.com/" });
  const tiktok = buildPlatformLaunchTarget({ id: "tiktok", url: "https://www.tiktok.com/" });
  const instagram = buildPlatformLaunchTarget({ id: "instagram", url: "https://www.instagram.com/" });
  const facebook = buildPlatformLaunchTarget({ id: "facebook", url: "https://www.facebook.com/" });

  assert.equal(target.url, "xhsdiscover://post_note/");
  assert.equal(target.appUrl, "xhsdiscover://post_note/");
  assert.equal(target.fallbackUrl, "https://creator.xiaohongshu.com/publish/publish?from=typecard&target=article");
  assert.equal(target.prefersSameTab, true);
  assert.equal(target.autoFallback, false);
  assert.equal(tiktok.appUrl, "tiktok://");
  assert.equal(tiktok.fallbackUrl, "https://www.tiktok.com/");
  assert.equal(tiktok.autoFallback, false);
  assert.equal(instagram.appUrl, "instagram://camera");
  assert.equal(instagram.autoFallback, false);
  assert.equal(facebook.appUrl, "fb://composer");
  assert.equal(facebook.autoFallback, false);
});

test("pending share state records enough data to resume reward claiming", () => {
  const state = buildPendingShareState({
    cardId: "table-a01",
    linkId: "rednote",
    createdAt: 1780636000000,
  });

  assert.deepEqual(state, {
    cardId: "table-a01",
    linkId: "rednote",
    createdAt: 1780636000000,
    leftAt: null,
    taskCompletedAt: null,
  });
  assert.equal(isPendingShareState(state, "table-a01"), true);
  assert.equal(isPendingShareState(state, "other-card"), false);
  assert.equal(isPendingShareState({ cardId: "table-a01" }, "table-a01"), false);
});

test("isRewardActionLink allows reward claiming for customer-facing actions", () => {
  assert.equal(isRewardActionLink({ category: "share" }), true);
  assert.equal(isRewardActionLink({ category: "review" }), true);
  assert.equal(isRewardActionLink({ category: "follow" }), true);
  assert.equal(isRewardActionLink({ category: "utility" }), false);
  assert.equal(isRewardActionLink(null), false);
});

test("isWeChatBrowser detects WeChat embedded browser user agents", () => {
  assert.equal(
    isWeChatBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50 NetType/WIFI Language/zh_CN",
    ),
    true,
  );
  assert.equal(
    isWeChatBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"),
    false,
  );
  assert.equal(isWeChatBrowser(""), false);
});
