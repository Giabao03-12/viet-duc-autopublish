import { randomUUID } from "crypto";
import { ALL_SLOTS, BRAND, CHANNELS, MAX_REVISIONS, MIN_LEAD_MIN, SLOTS, channelConfigured, env, ictParts, nextSlotInstant, type ChannelId } from "./config";
import { EDU_TOPICS, PRODUCT_TOPICS, PRODUCTS, approvedClaims, productById, type Product, type Topic } from "./catalog";
import { buildFooter, checkContent } from "./compliance";
import { reviewDraft, reviseDraft, writeDraft, type Draft, type DraftContext } from "./llm";
import * as meta from "./meta";
import { notify } from "./notify";
import { log } from "./log";
import { getStore } from "./store";
import type { Post, Settings, SlotId } from "./types";
import { checkVideoUrl, clearVideoState, driveDirectUrl, getVideoState as getVideoRec, pendingVideos, setVideoState, type VideoEntry } from "./videos";

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

/** Sản phẩm luân phiên theo ngày; `offset` lệch theo kênh để 2 Page cùng ngày nói về 2 sản phẩm khác nhau. */
export function pickProduct(date: string, offset = 0): Product {
  const dayIndex = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
  return PRODUCTS[(dayIndex + offset) % PRODUCTS.length];
}

export async function pickTopic(kind: "education" | "product", date: string, extraExclude: string[] = [], productOffset = 0): Promise<{ topic: Topic; claimIds: string[]; product?: Product; exhausted: boolean } | null> {
  const mem = await loadMemory(kind);
  const approved = approvedClaims().map((c) => c.id);
  const product = kind === "product" ? pickProduct(date, productOffset) : undefined;

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
  const topic = candidates[(Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000) + productOffset * 7) % candidates.length];
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
        const ai = await llm.reviewDraft(ctx, title, draft.body, buildFooter(ctx.kind, ctx.product, BRAND.educationFooter));
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

  const ch: ChannelId = SLOTS[slot].channel;
  if (!dryRun && !channelConfigured(ch)) {
    await log("info", "prepare", `[${slot}] Bỏ qua: chưa cấu hình Page ${CHANNELS[ch].name} (${CHANNELS[ch].pageIdEnv}/${CHANNELS[ch].tokenEnv})`);
    return { status: "disabled", reason: `Chưa cấu hình Page ${CHANNELS[ch].name}` };
  }

  const { date, at } = nextSlotInstant(at0, slot);
  const slotKind = SLOTS[slot].kind;
  if (slotKind === "video") return prepareVideoSlot({ slot, ch, date, at, at0, dryRun });
  const kind: "education" | "product" = slotKind;
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
    id: postId, slot, channel: ch, kind, date, publishAt: at.toISOString(), status: "draft", dryRun,
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
    const pick = await pickTopic(kind, date, [], CHANNELS[ch].productOffset);
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

    const match = await meta.inChannel(ch, () => meta.checkTokenMatchesPage());
    if (!match.ok) {
      await notify("error", `Token sai Page – ${CHANNELS[ch].name}`, `${match.detail}
Sửa biến trên Vercel rồi Redeploy.`, `token-mismatch:${ch}`);
      return fail("failed", `Token không khớp Page: ${match.detail}`, { ...common, caption: composed.fullCaption, imageUrl: post.imageUrl });
    }
    const imageUrl = post.imageUrl;
    const res = await meta.inChannel(ch, () => meta.schedulePhoto({ imageUrl, message: post.caption, publishAt: at }));
    post.fbPostId = res.fbPostId;
    post.status = "scheduled";
    post.error = undefined;
    await savePost(post);
    await rememberTopic(kind, pick.topic, pick.product?.id, composed.draft.body, pick.exhausted);
    const s2 = await getSettings();
    s2.lastPrepare = { ...(s2.lastPrepare ?? {}), [slot]: now() };
    await saveSettings(s2);
    await log("info", "prepare", `[${slot}] ${date} đã hẹn giờ trên Facebook (đã xác minh trong danh sách lên lịch, cách: ${res.method}): ${res.fbPostId}`, { topic: pick.topic.id });
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

// ───────────────────────── Video đã dựng (Page Sống Khỏe) ─────────────────────────
interface VideoSlotArgs { slot: SlotId; ch: ChannelId; date: string; at: Date; at0: Date; dryRun: boolean }

/** Chuẩn bị 1 khung giờ VIDEO: lấy video kế tiếp trong hàng chờ, kiểm duyệt caption, kiểm tra link Drive, hẹn giờ trên Facebook. */
async function prepareVideoSlot(a: VideoSlotArgs): Promise<PrepareResult> {
  const { slot, ch, date, at, at0, dryRun } = a;
  const label = SLOTS[slot].label;
  const leadMin = (at.getTime() - at0.getTime()) / 60000;
  if (!dryRun && leadMin < MIN_LEAD_MIN) {
    await log("warn", "prepare", `[${slot}] Quá sát giờ (${Math.round(leadMin)} phút) – bỏ lượt ${date}`);
    await notify("warn", `Bỏ lượt ${label} ${date}`, `Cron chạy quá muộn (còn ${Math.round(leadMin)} phút). Hệ thống KHÔNG đăng bù.`, `late:${date}:${slot}`);
    return { status: "skipped", reason: "Quá sát giờ đăng" };
  }

  const lockKey = `slot:${date}:${slot}`;
  const postId = randomUUID();
  if (!dryRun && !(await getStore().setnx(lockKey, postId, 4 * 86400))) {
    await log("info", "prepare", `[${slot}] ${date} đã được chuẩn bị – bỏ qua (chống trùng)`);
    return { status: "duplicate", reason: "Khung giờ này đã có bài" };
  }

  const queue = await pendingVideos();
  if (!queue.length) {
    if (!dryRun) await getStore().del(lockKey); // hàng chờ trống là bình thường; khi có video mới, lượt sau sẽ nhận
    await log("info", "prepare", `[${slot}] ${date}: hàng chờ video trống – không có gì để đăng`);
    return { status: "skipped", reason: "Hàng chờ video trống (chưa có video mới)" };
  }

  const base: Post = {
    id: postId, slot, channel: ch, kind: "video", date, publishAt: at.toISOString(), status: "draft", dryRun,
    topicId: "", topicLabel: "", titles: [], title: "", caption: "", hashtags: [], claimIds: [],
    imageKind: "education", attempts: 0, complianceLog: [], createdAt: now(), updatedAt: now(),
  };
  const fail = async (status: "skipped" | "failed", reason: string, extra?: Partial<Post>): Promise<PrepareResult> => {
    const p: Post = { ...base, ...extra, status, error: reason };
    await savePost(p);
    if (!dryRun && !p.fbPostId) await getStore().del(lockKey);
    await log(status === "failed" ? "error" : "warn", "prepare", `[${slot}] ${date} ${status}: ${reason}`);
    if (!dryRun) await notify(status === "failed" ? "error" : "warn", `${status === "failed" ? "LỖI" : "Bỏ lượt"} ${label} ${date}`, reason, `${status}:${date}:${slot}`);
    return { status, post: p, reason };
  };

  try {
    // Chọn video đầu hàng chờ có caption đạt kiểm duyệt; caption không đạt thì chặn video đó (kèm báo) rồi xét video kế tiếp
    let chosen: VideoEntry | null = null;
    let caption = "";
    for (const v of queue) {
      const rule = checkContent({
        kind: "education", title: v.title, body: v.caption, hashtags: v.hashtags, approved: approvedClaims(), allowedClaimIds: [], recentCaptions: [],
      });
      if (rule.issues.length) {
        if (!dryRun) {
          await setVideoState(v.id, { status: "blocked", reason: rule.issues.join(" | "), at: now() });
          await notify("error", `Video bị chặn: ${v.fileName}`, `Caption không đạt kiểm duyệt nên video KHÔNG được đăng:\n${rule.issues.join("\n")}\nHãy nhờ Claude sửa caption rồi thêm lại.`, `vblocked:${v.id}`);
        }
        await log("warn", "prepare", `[${slot}] Video ${v.id} bị chặn: ${rule.issues.join(" | ")}`);
        continue;
      }
      chosen = v;
      caption = `${v.title}\n\n${v.caption}\n\n${buildFooter("education", undefined, BRAND.educationFooter)}\n\n${v.hashtags.join(" ")}`;
      break;
    }
    if (!chosen) {
      if (!dryRun) await getStore().del(lockKey);
      return dryRun ? { status: "skipped", reason: "Mọi video trong hàng chờ đều bị chặn kiểm duyệt" } : fail("skipped", "Mọi video trong hàng chờ đều bị chặn kiểm duyệt – cần sửa caption");
    }

    const fileUrl = driveDirectUrl(chosen.driveFileId);
    const common: Partial<Post> = { topicId: chosen.id, topicLabel: chosen.fileName, videoId: chosen.id, driveFileId: chosen.driveFileId, titles: [chosen.title], title: chosen.title, hashtags: chosen.hashtags, caption, attempts: 1, complianceLog: ["Caption video đạt bộ luật kiểm duyệt giáo dục"] };

    const chk = await checkVideoUrl(fileUrl);
    if (!chk.ok) {
      const prev = await getVideoRec(chosen.id);
      const attempts = (prev && prev.status === "retry" ? prev.attempts : 0) + 1;
      // Lỗi link (thường do chưa chia sẻ Drive) KHÔNG chặn vĩnh viễn: giữ video ở đầu hàng chờ để lượt sau thử lại khi bạn chia sẻ xong
      if (!dryRun) await setVideoState(chosen.id, { status: "retry", attempts, reason: chk.detail, at: now() });
      return fail("failed", `Link video không tải được (${chosen.fileName}): ${chk.detail}. Kiểm tra file Drive đã chia sẻ "bất kỳ ai có link".`, common);
    }

    if (dryRun) {
      const post: Post = { ...base, ...common, status: "draft" } as Post;
      await savePost(post);
      return { status: "draft", post };
    }

    if (!(await getSettings()).autoEnabled) { await getStore().del(lockKey); return { status: "disabled", reason: "Bị tắt trong lúc chuẩn bị" }; }
    const match = await meta.inChannel(ch, () => meta.checkTokenMatchesPage());
    if (!match.ok) {
      await notify("error", `Token sai Page – ${CHANNELS[ch].name}`, `${match.detail}\nSửa biến trên Vercel rồi Redeploy.`, `token-mismatch:${ch}`);
      return fail("failed", `Token không khớp Page: ${match.detail}`, common);
    }

    const picked = chosen;
    const res = await meta.inChannel(ch, () => meta.scheduleVideo({ fileUrl, description: caption, title: picked.title, publishAt: at }));
    const stt = await meta.inChannel(ch, () => meta.getVideoState(res.videoId));
    if (!stt.exists) return fail("failed", `Facebook nhận lệnh hẹn video nhưng không thấy video ${res.videoId}`, common);

    const post: Post = { ...base, ...common, fbPostId: res.videoId, status: "scheduled" } as Post;
    await savePost(post);
    await setVideoState(picked.id, { status: "scheduled", slot, date, fbVideoId: res.videoId, at: now() });
    const left = (await pendingVideos()).length;
    const s2 = await getSettings();
    s2.lastPrepare = { ...(s2.lastPrepare ?? {}), [slot]: now() };
    await saveSettings(s2);
    await log("info", "prepare", `[${slot}] ${date} đã hẹn video ${picked.fileName} (${chk.detail}): ${res.videoId}`);
    const hh = String(SLOTS[slot].hour).padStart(2, "0");
    const mm = String(SLOTS[slot].minute).padStart(2, "0");
    await notify(left ? "info" : "warn", `Đã hẹn ${label} ${date}`, `Video: ${picked.fileName}\nTiêu đề: ${picked.title}\nFacebook Video ID: ${res.videoId}\nGiờ đăng: ${date} ${hh}:${mm} giờ VN\n${left ? `Còn ${left} video trong hàng chờ.` : "⚠️ Hàng chờ video đã HẾT – hãy đưa video mới vào Drive để lượt sau có bài."}`);
    return { status: "scheduled", post };
  } catch (e) {
    const err = e as Error;
    if (e instanceof meta.MetaError && e.isTokenError) await notify("error", "Token Facebook lỗi/hết hạn", `Meta trả lỗi ${e.code}: ${e.message}.`, `token-error:${ch}`);
    return fail("failed", `Lỗi: ${err.message}`);
  }
}

// ───────────────────────── Đăng thử (cần xác nhận của chủ page) ─────────────────────────
export async function publishTestPost(id: string): Promise<Post> {
  const p = await getPost(id);
  if (!p) throw new Error("Không thấy bài");
  if (p.status !== "draft") throw new Error("Chỉ đăng thử được bản nháp đã đạt kiểm duyệt");
  if (!p.imageUrl) throw new Error("Thiếu PUBLIC_BASE_URL");
  const imageUrl = p.imageUrl;
  const res = await meta.inChannel(p.channel, () => meta.publishPhotoNow({ imageUrl, message: p.caption }));
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
      try { const fid = p.fbPostId; await meta.inChannel(p.channel, () => meta.deleteRemote(fid)); p.status = "cancelled"; await savePost(p); n++; await getStore().del(`slot:${p.date}:${p.slot}`); if (p.kind === "video" && p.videoId) await clearVideoState(p.videoId); }
      catch (e) { await log("error", "cancel", `Không huỷ được ${p.fbPostId}: ${(e as Error).message}`); }
    }
  }
  return n;
}

// ───────────────────────── Watchdog: đối soát, token, cảnh báo ─────────────────────────
export async function watchdog(at: Date = new Date()) {
  const report: string[] = [];
  // 1) Token từng Page đã cấu hình
  for (const ch of Object.keys(CHANNELS) as ChannelId[]) {
    if (!channelConfigured(ch)) continue;
    const nm = CHANNELS[ch].name;
    try {
      const t = await meta.inChannel(ch, () => meta.tokenHealth());
      if (!t.valid) { report.push(`Token ${nm} KHÔNG hợp lệ`); await notify("error", `Token Facebook không hợp lệ – ${nm}`, t.note ?? "Hãy tạo lại Page Access Token.", `token-invalid:${ch}`); }
      else if (t.daysLeft !== null && t.daysLeft <= 7) { report.push(`Token ${nm} còn ${t.daysLeft} ngày`); await notify("warn", `Token Facebook sắp hết hạn – ${nm}`, `Còn ${t.daysLeft} ngày.`, `token-expiring:${ch}`); }
      else {
        const m = await meta.inChannel(ch, () => meta.checkTokenMatchesPage());
        if (!m.ok) { report.push(`Token ${nm} SAI PAGE`); await notify("error", `Token sai Page – ${nm}`, `${m.detail}
Sửa biến trên Vercel rồi Redeploy.`, `token-mismatch:${ch}`); }
        else report.push(`Token ${nm} ổn`);
      }
    } catch (e) { report.push(`Không kiểm tra được token ${nm}: ${(e as Error).message}`); }
  }

  // 2) Đối soát bài đã hẹn
  const posts = await listPosts(40);
  for (const p of posts) {
    if (!p.fbPostId) continue;
    const due = new Date(p.publishAt).getTime();
    // Bài đang hẹn đã quá giờ, HOẶC bài bị đánh "thất bại" trong 72h qua (có thể do báo nhầm trước đây) -> đối soát lại
    const recheckFailed = p.status === "failed" && at.getTime() - due < 72 * 3600000;
    if (p.status !== "scheduled" && !recheckFailed) continue;
    if (due > at.getTime()) continue;
    try {
      const fid = p.fbPostId;
      if (p.kind === "video") {
        const v = await meta.inChannel(p.channel, () => meta.getVideoState(fid));
        if (v.exists && v.published) {
          p.status = "posted"; p.fbPermalink = v.permalink; p.error = undefined; await savePost(p);
          if (p.videoId) await setVideoState(p.videoId, { status: "posted", fbVideoId: fid, permalink: v.permalink, at: now() });
          report.push(`Đã đăng video ${p.slot} ${p.date}`);
          await notify("info", `Đã đăng ${SLOTS[p.slot].label} ${p.date}`, `${p.title}\nVideo ID: ${fid}${v.permalink ? "\n" + v.permalink : ""}`);
        } else if (v.error || !v.exists || at.getTime() - due > 30 * 60000) {
          p.status = "failed"; p.error = v.error ?? (v.exists ? "Quá giờ 30 phút mà Facebook chưa đăng video" : "Video hẹn giờ không còn trên Facebook"); await savePost(p);
          if (p.videoId) await setVideoState(p.videoId, { status: "retry", attempts: 1, reason: p.error, at: now() }); // cho phép thử lại ở lượt sau
          report.push(`THẤT BẠI video ${p.slot} ${p.date}`);
          await notify("error", `Đăng video thất bại ${SLOTS[p.slot].label} ${p.date}`, `${p.error}\nVideo ID: ${fid}. Video được đưa về hàng chờ để thử lại; hệ thống KHÔNG đăng bù trong khung giờ này.`, `postfail:${p.id}`);
        }
        continue;
      }
      const r = await meta.inChannel(p.channel, () => meta.findRemotePost(fid, { title: p.title, publishAt: p.publishAt }));
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
    for (const slot of ALL_SLOTS) {
      if (!channelConfigured(SLOTS[slot].channel)) continue;
      if (SLOTS[slot].kind === "video" && !(await pendingVideos()).length) continue; // hàng chờ trống là bình thường
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
