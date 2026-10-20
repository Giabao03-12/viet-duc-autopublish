import { randomUUID } from "crypto";
import { BRAND, MAX_REVISIONS, MIN_LEAD_MIN, SLOTS, env, ictParts, nextSlotInstant } from "./config";
import { EDU_TOPICS, PRODUCT_TOPICS, PRODUCTS, approvedClaims, productById, type Product, type Topic } from "./catalog";
import { buildFooter, checkContent } from "./compliance";
import { reviewDraft, reviseDraft, writeDraft, type Draft, type DraftContext } from "./llm";
import * as meta from "./meta";
import { notify } from "./notify";
import { log } from "./log";
import { getStore } from "./store";
import type { Post, Settings, SlotId } from "./types";

const now = () => new Date().toISOString();

// ───────────────────────── Cài đặt BẬT/TẮT ─────────────────────────
export async function getSettings(): Promise<Settings> {
  return (await getStore().get<Settings>("settings")) ?? { autoEnabled: false, updatedAt: now(), updatedBy: "init" };
}
export async function saveSettings(s: Settings) { await getStore().set("settings", s); }

// ───────────────────────── Bài đăng ─────────────────────────
export async function savePost(p: Post) {
  p.updatedAt = now();
  const s = getStore();
  const existed = await s.get(`post:${p.id}`);
  await s.set(`post:${p.id}`, p);
  if (!existed) { await s.lpush("posts", p.id); await s.ltrim("posts", 0, 299); }
}
export async function getPost(id: string) { return getStore().get<Post>(`post:${id}`); }
export async function listPosts(limit = 40): Promise<Post[]> {
  const ids = await getStore().lrange<string>("posts", 0, limit - 1);
  const out: Post[] = [];
  for (const id of ids) { const p = await getPost(id); if (p) out.push(p); }
  return out;
}

// ───────────────────────── Chọn sản phẩm & chủ đề ─────────────────────────
interface Memory { used: string[]; lastGroup: Record<string, string>; recentCaptions: string[]; cycle: number }
const memKey = (kind: string) => `memory:${kind}`;
async function loadMemory(kind: string): Promise<Memory> {
  return (await getStore().get<Memory>(memKey(kind))) ?? { used: [], lastGroup: {}, recentCaptions: [], cycle: 0 };
}

/** Sản phẩm luân phiên theo ngày: ngày chẵn NANO, ngày lẻ RICH (đổi chiều theo dayIndex). */
export function pickProduct(date: string): Product {
  const dayIndex = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  return PRODUCTS[dayIndex % PRODUCTS.length];
}

export async function pickTopic(kind: "education" | "product", date: string, extraExclude: string[] = []): Promise<{ topic: Topic; claimIds: string[]; product?: Product; exhausted: boolean } | null> {
  const mem = await loadMemory(kind);
  const approved = approvedClaims().map((c) => c.id);
  const product = kind === "product" ? pickProduct(date) : undefined;

  let pool: (Topic & { productId?: string; claimIds?: string[] })[] =
    kind === "education" ? EDU_TOPICS : PRODUCT_TOPICS.filter((t) => t.productId === product!.id);
  // chủ đề cần claim thì claim phải được chủ page duyệt
  pool = pool.filter((t) => (t.claimIds ?? []).every((c) => approved.includes(c)));
  pool = pool.filter((t) => !extraExclude.includes(t.id));

  const lastGroup = mem.lastGroup[product?.id ?? "edu"];
  let fresh = pool.filter((t) => !mem.used.includes(t.id));
  let exhausted = false;
  if (!fresh.length) { fresh = pool; exhausted = true; } // hết kho -> quay vòng (và báo chủ page bổ sung)
  const noRepeatGroup = fresh.filter((t) => t.group !== lastGroup);
  const candidates = noRepeatGroup.length ? noRepeatGroup : fresh;
  if (!candidates.length) return null;
  const topic = candidates[Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) % candidates.length];
  return { topic, claimIds: (topic as { claimIds?: string[] }).claimIds ?? [], product, exhausted };
}

async function rememberTopic(kind: "education" | "product", topic: Topic, productId: string | undefined, caption: string, exhausted: boolean) {
  const mem = await loadMemory(kind);
  mem.used = exhausted ? [topic.id] : [...mem.used, topic.id];
  if (exhausted) mem.cycle++;
  mem.lastGroup[productId ?? "edu"] = topic.group;
  mem.recentCaptions = [caption, ...mem.recentCaptions].slice(0, 30);
  await getStore().set(memKey(kind), mem);
}

// ───────────────────────── Soạn + kiểm duyệt (tối đa 3 lần sửa) ─────────────────────────
export interface Composed {
  draft: Draft;
  title: string;
  fullCaption: string;
  usedClaimIds: string[];
  attempts: number;
  log: string[];
  ok: boolean;
}

export interface LlmImpl { writeDraft: typeof writeDraft; reviseDraft: typeof reviseDraft; reviewDraft: typeof reviewDraft }
const realLlm: LlmImpl = { writeDraft, reviseDraft, reviewDraft };

export async function composeAndCheck(ctx: DraftContext, allowedClaimIds: string[], recentCaptions: string[], llm: LlmImpl = realLlm): Promise<Composed> {
  const logLines: string[] = [];
  let draft = await llm.writeDraft(ctx);
  let attempts = 1;
  for (;;) {
    const title = draft.titles[draft.chosenIndex] ?? draft.titles[0] ?? "";
    const rule = checkContent({
      kind: ctx.kind, title, body: draft.body, hashtags: draft.hashtags, titles: draft.titles,
      product: ctx.product, approved: approvedClaims(), allowedClaimIds, recentCaptions,
    });
    let issues = [...rule.issues];
    if (!issues.length) {
      try {
        const ai = await llm.reviewDraft(ctx, title, draft.body);
        if (!ai.pass) issues = ai.issues.length ? ai.issues.map((i) => `[ai-review] ${i}`) : ["[ai-review] Không đạt kiểm duyệt (không nêu lý do)"];
      } catch (e) {
        issues = [`[ai-review] Không chạy được bước kiểm duyệt AI: ${(e as Error).message}`]; // lỗi kiểm duyệt = KHÔNG đăng
      }
    }
    logLines.push(`Lần ${attempts}: ${issues.length ? "KHÔNG ĐẠT — " + issues.join(" | ") : "ĐẠT"}`);
    if (!issues.length) {
      const footer = buildFooter(ctx.kind, ctx.product, BRAND.educationFooter);
      const tags = draft.hashtags.join(" ");
      return { draft, title, fullCaption: `${title}\n\n${draft.body}\n\n${footer}\n\n${tags}`, usedClaimIds: rule.usedClaimIds, attempts, log: logLines, ok: true };
    }
    if (attempts > MAX_REVISIONS) { // 1 lần viết + tối đa 3 lần sửa
      return { draft, title, fullCaption: "", usedClaimIds: [], attempts, log: logLines, ok: false };
    }
    draft = await llm.reviseDraft(ctx, draft, issues);
    attempts++;
  }
}

// ───────────────────────── Chuẩn bị 1 khung giờ ─────────────────────────
export interface PrepareOptions { slot: SlotId; dryRun?: boolean; now?: Date; force?: boolean }
export interface PrepareResult { status: "scheduled" | "draft" | "skipped" | "disabled" | "duplicate" | "failed"; post?: Post; reason?: string }

export async function prepareSlot(opts: PrepareOptions): Promise<PrepareResult> {
  const { slot } = opts;
  const dryRun = !!opts.dryRun;
  const at0 = opts.now ?? new Date();
  const settings = await getSettings();

  if (!dryRun && !settings.autoEnabled) {
    await log("info", "prepare", `[${slot}] Bỏ qua: chế độ đăng tự động đang TẮT`);
    return { status: "disabled", reason: "Chế độ đăng tự động đang tắt" };
  }

  const { date, at } = nextSlotInstant(at0, slot);
  const kind = SLOTS[slot].kind;
  const leadMin = (at.getTime() - at0.getTime()) / 60000;

  if (!dryRun && leadMin < MIN_LEAD_MIN) {
    // Không đăng bù, không đăng vội: bỏ lượt và báo.
    await log("warn", "prepare", `[${slot}] Quá sát giờ (${Math.round(leadMin)} phút) – bỏ lượt ${date}`);
    await notify("warn", `Bỏ lượt ${SLOTS[slot].label} ${date}`, `Cron chạy quá muộn (còn ${Math.round(leadMin)} phút tới giờ đăng, cần ≥ ${MIN_LEAD_MIN}). Hệ thống KHÔNG đăng bù.`, `late:${date}:${slot}`);
    return { status: "skipped", reason: "Quá sát giờ đăng" };
  }

  // Chống đăng trùng: mỗi (ngày, khung giờ) chỉ có đúng 1 lượt chuẩn bị.
  const lockKey = `slot:${date}:${slot}`;
  const postId = randomUUID();
  if (!dryRun) {
    const got = await getStore().setnx(lockKey, postId, 4 * 86400);
    if (!got) {
      await log("info", "prepare", `[${slot}] ${date} đã được chuẩn bị – bỏ qua (chống trùng)`);
      return { status: "duplicate", reason: "Khung giờ này đã có bài" };
    }
  }

  const base: Post = {
    id: postId, slot, kind, date, publishAt: at.toISOString(), status: "draft", dryRun,
    topicId: "", topicLabel: "", titles: [], title: "", caption: "", hashtags: [], claimIds: [],
    imageKind: kind, attempts: 0, complianceLog: [], createdAt: now(), updatedAt: now(),
  };

  const fail = async (status: "skipped" | "failed", reason: string, extra?: Partial<Post>): Promise<PrepareResult> => {
    const p: Post = { ...base, ...extra, status, error: reason };
    await savePost(p);
    // Lỗi kỹ thuật (chưa hẹn được gì) -> mở khoá để có thể chạy lại thủ công. Bài bị loại kiểm duyệt giữ khoá.
    if (!dryRun && status === "failed" && !p.fbPostId) await getStore().del(lockKey);
    await log(status === "failed" ? "error" : "warn", "prepare", `[${slot}] ${date} ${status}: ${reason}`);
    if (!dryRun) await notify(status === "failed" ? "error" : "warn", `${status === "failed" ? "LỖI" : "Bỏ lượt"} ${SLOTS[slot].label} ${date}`, reason, `${status}:${date}:${slot}`);
    return { status, post: p, reason };
  };

  try {
    const pick = await pickTopic(kind, date);
    if (!pick) return fail("skipped", "Không còn chủ đề hợp lệ (có thể do claim chưa được duyệt). Cần bổ sung chủ đề hoặc duyệt claim trong APPROVED_CLAIMS.");
    if (pick.exhausted && !dryRun) await notify("warn", "Kho chủ đề đã dùng hết một vòng", `Nhóm ${kind}: hệ thống quay vòng chủ đề. Hãy bổ sung chủ đề mới trong lib/catalog.ts để tránh lặp lại.`, `exhausted:${kind}`);

    const claims = approvedClaims().filter((c) => pick.claimIds.includes(c.id));
    const ctx: DraftContext = {
      kind, topic: pick.topic, product: pick.product, claims,
      dateLabel: `${date.split("-").reverse().join("/")} (${SLOTS[slot].label})`,
    };
    const mem = await loadMemory(kind);
    const composed = await composeAndCheck(ctx, pick.claimIds, mem.recentCaptions);

    const common: Partial<Post> = {
      topicId: pick.topic.id, topicLabel: pick.topic.label, productId: pick.product?.id,
      titles: composed.draft.titles, title: composed.title, hashtags: composed.draft.hashtags,
      attempts: composed.attempts, complianceLog: composed.log,
    };
    if (!composed.ok) return fail("skipped", `Không đạt kiểm duyệt sau ${composed.attempts} lần soạn/sửa. ${composed.log.at(-1)}`, common);

    const publicBase = env("PUBLIC_BASE_URL").replace(/\/$/, "");
    const post: Post = {
      ...base, ...common, caption: composed.fullCaption, claimIds: composed.usedClaimIds,
      imageUrl: publicBase ? `${publicBase}/api/image/${postId}.png` : undefined,
    } as Post;

    if (dryRun) {
      post.status = "draft";
      await savePost(post);
      await log("info", "dry-run", `[${slot}] Bản nháp ${pick.topic.id} đạt kiểm duyệt sau ${composed.attempts} lần`);
      return { status: "draft", post };
    }

    // Lưu trước khi gọi Meta để ảnh có dữ liệu render.
    post.status = "failed"; // mặc định lỗi cho tới khi Meta xác nhận
    await savePost(post);

    if (!post.imageUrl) return fail("failed", "Thiếu PUBLIC_BASE_URL – Facebook không tải được ảnh", { ...common, caption: composed.fullCaption });
    const img = env("SKIP_IMAGE_CHECK") === "1" ? ({ ok: true, status: 200, headers: new Headers({ "content-type": "image/png" }) } as Response) : await fetch(post.imageUrl, { cache: "no-store" }).catch(() => null);
    if (!img || !img.ok || !(img.headers.get("content-type") ?? "").includes("image")) {
      return fail("failed", `Ảnh không tạo được/không truy cập công khai (${img?.status ?? "no response"})`, { ...common, caption: composed.fullCaption, imageUrl: post.imageUrl });
    }

    // Kiểm tra lại trạng thái ngay trước khi hẹn: người dùng có thể vừa TẮT.
    if (!(await getSettings()).autoEnabled) { post.status = "cancelled"; post.error = "Bị tắt trong lúc chuẩn bị"; await savePost(post); return { status: "disabled", post }; }

    const res = await meta.schedulePhoto({ imageUrl: post.imageUrl, message: post.caption, publishAt: at });
    post.fbPostId = res.fbPostId;
    post.status = "scheduled";
    post.error = undefined;
    await savePost(post);
    await rememberTopic(kind, pick.topic, pick.product?.id, composed.draft.body, pick.exhausted);
    const s2 = await getSettings();
    s2.lastPrepare = { ...(s2.lastPrepare ?? {}), [slot]: now() };
    await saveSettings(s2);
    await log("info", "prepare", `[${slot}] ${date} đã hẹn giờ trên Facebook: ${res.fbPostId}`, { topic: pick.topic.id });
    await notify("info", `Đã hẹn ${SLOTS[slot].label} ${date}`, `Tiêu đề: ${post.title}\nChủ đề: ${post.topicLabel}\nFacebook Post ID: ${res.fbPostId}\nGiờ đăng: ${at.toISOString()} (${date} ${String(SLOTS[slot].hour).padStart(2, "0")}:00 giờ VN)`);
    return { status: "scheduled", post };
  } catch (e) {
    const err = e as Error;
    if (e instanceof meta.MetaError && e.isTokenError) {
      await notify("error", "Token Facebook lỗi/hết hạn", `Meta trả lỗi ${e.code}: ${e.message}. Cần tạo lại Page Access Token.`, "token-error");
    }
    return fail("failed", `Lỗi: ${err.message}`);
  }
}

// ───────────────────────── Đăng thử (cần xác nhận của chủ page) ─────────────────────────
export async function publishTestPost(id: string): Promise<Post> {
  const p = await getPost(id);
  if (!p) throw new Error("Không thấy bài");
  if (p.status !== "draft") throw new Error("Chỉ đăng thử được bản nháp đã đạt kiểm duyệt");
  if (!p.imageUrl) throw new Error("Thiếu PUBLIC_BASE_URL");
  const res = await meta.publishPhotoNow({ imageUrl: p.imageUrl, message: p.caption });
  p.fbPostId = res.fbPostId;
  p.status = "posted";
  p.dryRun = false;
  await savePost(p);
  const st = await getSettings();
  st.testPostOkAt = now();
  await saveSettings(st);
  await log("info", "test-post", `Đăng thử thành công: ${res.fbPostId}`);
  return p;
}

// ───────────────────────── Tắt tự động: huỷ bài đã hẹn ─────────────────────────
export async function cancelScheduled(): Promise<number> {
  const posts = await listPosts(60);
  let n = 0;
  for (const p of posts) {
    if (p.status === "scheduled" && new Date(p.publishAt).getTime() > Date.now() && p.fbPostId) {
      try { await meta.deleteRemote(p.fbPostId); p.status = "cancelled"; await savePost(p); n++; await getStore().del(`slot:${p.date}:${p.slot}`); }
      catch (e) { await log("error", "cancel", `Không huỷ được ${p.fbPostId}: ${(e as Error).message}`); }
    }
  }
  return n;
}

// ───────────────────────── Watchdog: đối soát, token, cảnh báo ─────────────────────────
export async function watchdog(at: Date = new Date()) {
  const report: string[] = [];
  // 1) Token
  try {
    const t = await meta.tokenHealth();
    if (!t.valid) { report.push("Token KHÔNG hợp lệ"); await notify("error", "Token Facebook không hợp lệ", t.note ?? "Hãy tạo lại Page Access Token.", "token-invalid"); }
    else if (t.daysLeft !== null && t.daysLeft <= 7) { report.push(`Token còn ${t.daysLeft} ngày`); await notify("warn", "Token Facebook sắp hết hạn", `Còn ${t.daysLeft} ngày.`, "token-expiring"); }
    else report.push(`Token ổn (${t.neverExpires ? "không hết hạn" : t.daysLeft === null ? "không rõ hạn" : t.daysLeft + " ngày"})`);
  } catch (e) { report.push(`Không kiểm tra được token: ${(e as Error).message}`); }

  // 2) Đối soát bài đã hẹn
  const posts = await listPosts(40);
  for (const p of posts) {
    if (!p.fbPostId) continue;
    const due = new Date(p.publishAt).getTime();
    // Bài đang hẹn đã quá giờ, HOẶC bài bị đánh "thất bại" trong 24h qua (có thể do báo nhầm trước đây) -> đối soát lại
    const recheckFailed = p.status === "failed" && at.getTime() - due < 24 * 3600000;
    if (p.status !== "scheduled" && !recheckFailed) continue;
    if (due > at.getTime()) continue;
    try {
      const r = await meta.findRemotePost(p.fbPostId, { title: p.title, publishAt: p.publishAt });
      if (r.exists && r.published) {
        const wasFailed = p.status === "failed";
        p.status = "posted"; p.fbPermalink = r.permalink; p.error = undefined; if (r.postId) p.fbPostId = r.postId; await savePost(p);
        report.push(`Đã đăng ${p.slot} ${p.date}`);
        await log("info", "watchdog", `Xác nhận đã đăng ${p.fbPostId}${wasFailed ? " (sửa báo nhầm thất bại)" : ""}`);
        await notify("info", `Đã đăng ${SLOTS[p.slot].label} ${p.date}${wasFailed ? " (cảnh báo thất bại trước đó là báo nhầm)" : ""}`, `${p.title}\nPost ID: ${p.fbPostId}${r.permalink ? "\n" + r.permalink : ""}`);
      } else if (recheckFailed || r.unknown) {
        continue; // không chắc chắn -> không báo thêm lỗi, đợi lượt sau
      } else if (at.getTime() - due > 20 * 60000) {
        p.status = "failed"; p.error = r.exists ? "Quá giờ 20 phút mà Facebook chưa đăng" : "Bài hẹn giờ không còn trên Facebook"; await savePost(p);
        report.push(`THẤT BẠI ${p.slot} ${p.date}`);
        await notify("error", `Đăng thất bại ${SLOTS[p.slot].label} ${p.date}`, `${p.error}\nPost ID: ${p.fbPostId}. Hệ thống KHÔNG tự đăng bù.`, `postfail:${p.id}`);
      }
    } catch (e) { report.push(`Lỗi đối soát ${p.fbPostId}: ${(e as Error).message}`); }
  }

  // 3) Phát hiện hệ thống bỏ lỡ khâu chuẩn bị: khung giờ sắp tới < 3h mà chưa có bài
  const settings = await getSettings();
  if (settings.autoEnabled) {
    for (const slot of Object.keys(SLOTS) as SlotId[]) {
      const { date, at: when } = nextSlotInstant(at, slot);
      const hours = (when.getTime() - at.getTime()) / 3600000;
      if (hours < 3 && !(await getStore().get(`slot:${date}:${slot}`))) {
        report.push(`Chưa có bài cho ${slot} ${date}`);
        await notify("error", `Chưa có bài cho ${SLOTS[slot].label} ${date}`, "Cron chuẩn bị chưa chạy hoặc bị lỗi. Kiểm tra Vercel > Logs. Hệ thống sẽ không đăng bù.", `missing:${date}:${slot}`);
      }
    }
  }
  await getStore().set("heartbeat", { at: now(), report });
  await log("info", "watchdog", report.join(" · ") || "ok");
  return report;
}

export function describeNow() { const p = ictParts(new Date()); return `${p.date} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")} (giờ VN)`; }
export { productById };
