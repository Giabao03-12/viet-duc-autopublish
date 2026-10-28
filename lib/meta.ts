import { AsyncLocalStorage } from "async_hooks";
import { CHANNELS, env, isMockMeta, type ChannelId } from "./config";

/** Kênh (Fanpage) hiện hành cho mọi lệnh gọi Graph API trong `inChannel(...)`. Mặc định: Khoẻ Trẻ Đẹp. */
const channelCtx = new AsyncLocalStorage<ChannelId>();
export const inChannel = <T>(ch: ChannelId | undefined, fn: () => Promise<T>) => channelCtx.run(ch ?? "ktd", fn);
export const currentChannel = (): ChannelId => channelCtx.getStore() ?? "ktd";
const pageToken = () => env(CHANNELS[currentChannel()].tokenEnv);

/** Meta Graph API chính thức. Không dùng trình duyệt/scraping. */
const V = () => env("META_GRAPH_VERSION") || "v22.0";
const base = () => `https://graph.facebook.com/${V()}`;

export class MetaError extends Error {
  constructor(public code: number | undefined, public subcode: number | undefined, message: string) {
    super(message);
  }
  get isTokenError() { return this.code === 190 || this.code === 102 || this.code === 10 || this.code === 200; }
}

async function graph<T>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const token = pageToken();
  if (!token) throw new MetaError(undefined, undefined, `Thiếu ${CHANNELS[currentChannel()].tokenEnv}`);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, access_token: token })) body.set(k, String(v));
  const url = method === "POST" ? `${base()}${path}` : `${base()}${path}?${body}`;
  const r = await fetch(url, method === "POST" ? { method, body, headers: { "Content-Type": "application/x-www-form-urlencoded" } } : { method });
  const j = (await r.json()) as { error?: { message: string; code: number; error_subcode?: number } } & T;
  if (!r.ok || j.error) throw new MetaError(j.error?.code, j.error?.error_subcode, j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

export const pageId = () => env(CHANNELS[currentChannel()].pageIdEnv);

export interface PageInfo { id: string; name: string; link?: string }

export async function getPage(): Promise<PageInfo> {
  if (isMockMeta()) return { id: pageId() || "MOCK", name: `${CHANNELS[currentChannel()].name} (giả lập)` };
  return graph<PageInfo>("GET", `/${pageId()}`, { fields: "id,name,link" });
}

/**
 * Token phải là TOKEN CỦA ĐÚNG PAGE (không phải token người dùng, không phải token Page khác).
 * Với token Page, /me trả về chính Page đó.
 */
export async function checkTokenMatchesPage(): Promise<{ ok: boolean; detail: string }> {
  if (isMockMeta()) return { ok: true, detail: "giả lập" };
  const ch = CHANNELS[currentChannel()];
  if (!pageId()) return { ok: false, detail: `Thiếu ${ch.pageIdEnv}` };
  try {
    const me = await graph<{ id: string; name?: string }>("GET", "/me", { fields: "id,name" });
    if (me.id === pageId()) return { ok: true, detail: `Token đúng của Page ${me.name ?? me.id}` };
    return {
      ok: false,
      detail: `${ch.tokenEnv} đang là token của "${me.name ?? me.id}" (ID ${me.id}), KHÔNG phải token của Page ${ch.name} (ID ${pageId()} trong ${ch.pageIdEnv}). Có thể đã dán token người dùng hoặc dán nhầm biến.`,
    };
  } catch (e) {
    return { ok: false, detail: `Không kiểm tra được token: ${(e as Error).message}` };
  }
}

export interface TokenHealth { valid: boolean; expiresAt: number | null; neverExpires: boolean; scopes: string[]; daysLeft: number | null; note?: string }

export async function tokenHealth(): Promise<TokenHealth> {
  if (isMockMeta()) return { valid: true, expiresAt: null, neverExpires: true, scopes: ["pages_manage_posts"], daysLeft: null, note: "giả lập" };
  const token = pageToken();
  const appId = env("META_APP_ID"), secret = env("META_APP_SECRET");
  if (!token) return { valid: false, expiresAt: null, neverExpires: false, scopes: [], daysLeft: null, note: "Thiếu token" };
  if (!appId || !secret) {
    try { await getPage(); return { valid: true, expiresAt: null, neverExpires: false, scopes: [], daysLeft: null, note: "Không có APP_ID/SECRET nên không đọc được hạn token" }; }
    catch (e) { return { valid: false, expiresAt: null, neverExpires: false, scopes: [], daysLeft: null, note: (e as Error).message }; }
  }
  const u = `${base()}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appId}|${secret}`;
  const j = (await (await fetch(u)).json()) as { data?: { is_valid: boolean; expires_at: number; scopes?: string[] }; error?: { message: string } };
  if (!j.data) return { valid: false, expiresAt: null, neverExpires: false, scopes: [], daysLeft: null, note: j.error?.message };
  const never = j.data.expires_at === 0;
  const daysLeft = never ? null : Math.floor((j.data.expires_at * 1000 - Date.now()) / 86400000);
  return { valid: j.data.is_valid, expiresAt: never ? null : j.data.expires_at, neverExpires: never, scopes: j.data.scopes ?? [], daysLeft };
}

export interface PublishResult { fbPostId: string; photoId?: string; method?: string }

export interface ScheduledItem { id: string; message?: string; scheduled_publish_time?: number | string }

export async function listScheduled(): Promise<ScheduledItem[]> {
  const r = await graph<{ data: ScheduledItem[] }>("GET", `/${pageId()}/scheduled_posts`, { fields: "id,message,scheduled_publish_time", limit: 50 });
  return r.data ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tìm bài đang hẹn giờ có nội dung bắt đầu giống `message` (thử vài lần vì Facebook cập nhật chậm vài giây). */
async function findScheduledByMessage(message: string): Promise<ScheduledItem | undefined> {
  const key = message.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, 40);
  for (let i = 0; i < 4; i++) {
    try {
      const hit = (await listScheduled()).find((x) => (x.message ?? "").normalize("NFC").replace(/\s+/g, " ").trim().startsWith(key));
      if (hit) return hit;
    } catch { /* thử lại */ }
    await sleep(2500);
  }
  return undefined;
}

/**
 * Hẹn giờ ngay trên Facebook (Facebook tự đăng đúng giờ, không phụ thuộc độ chính xác của cron).
 * Sau khi hẹn, BẮT BUỘC xác minh bài có trong danh sách "đã lên lịch" của Page; trả về MÃ BÀI VIẾT thật.
 * Cách 1 (chuẩn): tải ảnh ẩn -> tạo bài /feed hẹn giờ có gắn ảnh. Cách 2 (dự phòng): /photos có scheduled_publish_time.
 * Cả hai không xác minh được -> ném lỗi để báo ngay (không đợi tới giờ đăng mới biết).
 */
export async function schedulePhoto(opts: { imageUrl: string; message: string; publishAt: Date }): Promise<PublishResult> {
  const ts = Math.floor(opts.publishAt.getTime() / 1000);
  if (isMockMeta()) return { fbPostId: `MOCK_${pageId() || "page"}_${ts}`, photoId: `MOCKPHOTO_${ts}`, method: "mock" };
  const errors: string[] = [];

  // Cách 1: ảnh ẩn + bài hẹn giờ có gắn ảnh
  try {
    const photo = await graph<{ id: string }>("POST", `/${pageId()}/photos`, { url: opts.imageUrl, published: false, temporary: true });
    const post = await graph<{ id: string }>("POST", `/${pageId()}/feed`, {
      message: opts.message,
      attached_media: JSON.stringify([{ media_fbid: photo.id }]),
      published: false,
      scheduled_publish_time: ts,
    });
    const found = await findScheduledByMessage(opts.message);
    if (found) return { fbPostId: found.id, photoId: photo.id, method: "feed+photo" };
    errors.push(`Cách 1 tạo bài ${post.id} nhưng không thấy trong danh sách lên lịch`);
    try { await graph("DELETE", `/${post.id}`); } catch { /* bỏ qua */ }
  } catch (e) {
    if (e instanceof MetaError && e.isTokenError) throw e;
    errors.push(`Cách 1 lỗi: ${(e as Error).message}`);
  }

  // Cách 2: /photos có hẹn giờ
  try {
    const j = await graph<{ id: string; post_id?: string }>("POST", `/${pageId()}/photos`, {
      url: opts.imageUrl, caption: opts.message, published: false, scheduled_publish_time: ts, unpublished_content_type: "SCHEDULED",
    });
    const found = await findScheduledByMessage(opts.message);
    if (found) return { fbPostId: found.id, photoId: j.id, method: "photos-scheduled" };
    errors.push(`Cách 2 tạo ảnh ${j.id} nhưng không thấy trong danh sách lên lịch`);
    try { await graph("DELETE", `/${j.id}`); } catch { /* bỏ qua */ }
  } catch (e) {
    if (e instanceof MetaError && e.isTokenError) throw e;
    errors.push(`Cách 2 lỗi: ${(e as Error).message}`);
  }

  throw new MetaError(undefined, undefined, `Không hẹn giờ được trên Facebook. ${errors.join(" | ")}`);
}

/**
 * Hẹn giờ đăng VIDEO: Facebook tự tải `file_url` (link công khai) rồi đăng đúng giờ.
 * Trả về mã video; sau đó phải kiểm tra bằng getVideoState.
 */
/** POST multipart (cần khi gửi kèm file ảnh bìa). */
async function graphForm<T>(path: string, fields: Record<string, string | number | boolean>, file?: { name: string; field: string; bytes: Uint8Array; type: string }): Promise<T> {
  const token = pageToken();
  if (!token) throw new MetaError(undefined, undefined, `Thiếu ${CHANNELS[currentChannel()].tokenEnv}`);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...fields, access_token: token })) fd.set(k, String(v));
  if (file) fd.set(file.field, new Blob([file.bytes as BlobPart], { type: file.type }), file.name);
  const r = await fetch(`${base()}${path}`, { method: "POST", body: fd });
  const j = (await r.json()) as { error?: { message: string; code: number; error_subcode?: number } } & T;
  if (!r.ok || j.error) throw new MetaError(j.error?.code, j.error?.error_subcode, j.error?.message ?? `HTTP ${r.status}`);
  return j;
}

async function fetchCover(url?: string): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    return b.length > 1000 && b.length < 10_000_000 ? b : null;
  } catch { return null; }
}

export async function scheduleVideo(opts: { fileUrl: string; description: string; title: string; publishAt: Date; coverUrl?: string }): Promise<{ videoId: string; cover: "thumb" | "thumbnails" | "none" }> {
  const ts = Math.floor(opts.publishAt.getTime() / 1000);
  if (isMockMeta()) return { videoId: `MOCKVIDEO_${ts}`, cover: opts.coverUrl ? "thumb" : "none" };
  const fields = { file_url: opts.fileUrl, description: opts.description, title: opts.title.slice(0, 100), published: false, scheduled_publish_time: ts };
  const cover = await fetchCover(opts.coverUrl);
  if (cover) {
    const file = { name: "cover.jpg", field: "thumb", bytes: cover, type: "image/jpeg" };
    try {
      const j = await graphForm<{ id: string }>(`/${pageId()}/videos`, fields, file);
      return { videoId: j.id, cover: "thumb" };
    } catch { /* thử lại không kèm bìa, rồi gắn bìa sau */ }
  }
  const j = await graph<{ id: string }>("POST", `/${pageId()}/videos`, fields);
  if (cover) {
    try { await graphForm(`/${j.id}/thumbnails`, { is_preferred: true }, { name: "cover.jpg", field: "source", bytes: cover, type: "image/jpeg" }); return { videoId: j.id, cover: "thumbnails" }; }
    catch { /* bìa là phần phụ: video vẫn đã hẹn giờ */ }
  }
  return { videoId: j.id, cover: "none" };
}

export interface VideoState { exists: boolean; published: boolean; scheduledFor?: number; processing?: string; error?: string; permalink?: string }

/** Trạng thái video trên Facebook: đã đăng chưa, đang xử lý, hay Facebook không tải được file. */
export async function getVideoState(id: string): Promise<VideoState> {
  if (isMockMeta()) return { exists: true, published: true, permalink: `https://facebook.com/${id}` };
  try {
    const j = await graph<{ published?: boolean; scheduled_publish_time?: number | string; permalink_url?: string; status?: { video_status?: string; processing_progress?: number } }>(
      "GET", `/${id}`, { fields: "published,scheduled_publish_time,permalink_url,status" });
    const vs = j.status?.video_status;
    return {
      exists: true, published: j.published === true, scheduledFor: j.scheduled_publish_time ? Number(j.scheduled_publish_time) : undefined,
      processing: vs, error: vs === "error" ? "Facebook báo lỗi xử lý video (thường do không tải được file từ link)" : undefined, permalink: fullLink(j.permalink_url),
    };
  } catch (e) {
    if (e instanceof MetaError && (e.code === 100 || e.code === 803)) return { exists: false, published: false };
    throw e;
  }
}

/** Đăng ngay – CHỈ dùng cho bài đăng thử có xác nhận của chủ page. */
export async function publishPhotoNow(opts: { imageUrl: string; message: string }): Promise<PublishResult> {
  if (isMockMeta()) return { fbPostId: `MOCK_${pageId() || "page"}_NOW_${Date.now()}` };
  const j = await graph<{ id: string; post_id?: string }>("POST", `/${pageId()}/photos`, { url: opts.imageUrl, caption: opts.message, published: true });
  return { fbPostId: j.post_id ?? j.id, photoId: j.id };
}

export interface RemotePost { published: boolean; permalink?: string; scheduledFor?: number; exists: boolean; postId?: string; unknown?: boolean }

const fullLink = (l?: string) => (l ? (l.startsWith("http") ? l : `https://www.facebook.com${l}`) : undefined);
const norm = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Xác định bài đã đăng chưa. Lưu ý: bài ẢNH hẹn giờ trả về MÃ ẢNH (không phải mã bài), nên phải thử nhiều cách:
 * 1) hỏi trực tiếp như một bài viết; 2) hỏi như một ảnh -> lấy page_story_id; 3) dò danh sách bài đã đăng của Page theo tiêu đề + giờ.
 * Chỉ trả `exists:false` khi đã dò cả bài đã đăng lẫn bài đang hẹn mà không thấy. Lỗi không xác định -> `unknown:true` (không được coi là thất bại).
 */
export async function findRemotePost(id: string, hint: { title: string; publishAt: string }): Promise<RemotePost> {
  if (isMockMeta()) return { exists: true, published: true, permalink: `https://facebook.com/${id}`, postId: id };
  // 1) như một bài viết (id dạng pageId_postId)
  try {
    const j = await graph<{ is_published?: boolean; permalink_url?: string; scheduled_publish_time?: number | string }>("GET", `/${id}`, { fields: "is_published,permalink_url,scheduled_publish_time" });
    return { exists: true, published: j.is_published !== false, permalink: fullLink(j.permalink_url), scheduledFor: j.scheduled_publish_time ? Number(j.scheduled_publish_time) : undefined, postId: id };
  } catch { /* có thể là mã ảnh -> thử tiếp */ }
  // 2) như một ảnh
  try {
    const p = await graph<{ page_story_id?: string; link?: string }>("GET", `/${id}`, { fields: "page_story_id,link" });
    if (p.page_story_id) {
      try {
        const j = await graph<{ is_published?: boolean; permalink_url?: string }>("GET", `/${p.page_story_id}`, { fields: "is_published,permalink_url" });
        if (j.is_published !== false) return { exists: true, published: true, permalink: fullLink(j.permalink_url) ?? p.link, postId: p.page_story_id };
      } catch { /* dò tiếp */ }
    }
  } catch { /* dò tiếp */ }
  // 3) dò bài đã đăng của Page theo tiêu đề, trong khoảng giờ đăng
  const due = Date.parse(hint.publishAt);
  const t = norm(hint.title).slice(0, 40);
  try {
    const list = await graph<{ data: { id: string; message?: string; created_time?: string; permalink_url?: string }[] }>("GET", `/${pageId()}/published_posts`, { fields: "id,message,created_time,permalink_url", limit: 30 });
    const hit = list.data.find((x) => x.message && norm(x.message).includes(t) && (!x.created_time || Math.abs(Date.parse(x.created_time) - due) < 3 * 3600000));
    if (hit) return { exists: true, published: true, permalink: fullLink(hit.permalink_url), postId: hit.id };
  } catch (e) {
    if (e instanceof MetaError && e.isTokenError) throw e;
    return { exists: true, published: false, unknown: true };
  }
  // 4) còn trong danh sách đang hẹn giờ?
  try {
    const sch = await graph<{ data: { id: string; message?: string }[] }>("GET", `/${pageId()}/scheduled_posts`, { fields: "id,message", limit: 30 });
    if (sch.data.some((x) => x.message && norm(x.message).includes(t))) return { exists: true, published: false };
  } catch { return { exists: true, published: false, unknown: true }; }
  return { exists: false, published: false };
}

export async function deleteRemote(id: string): Promise<void> {
  if (isMockMeta()) return;
  await graph("DELETE", `/${id}`);
}
