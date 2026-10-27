import queueFile from "../content/videos.json";
import { env } from "./config";
import { getStore } from "./store";

/**
 * Hàng chờ video đã dựng (Drive thư mục Viet-Duc-Videos) cho Page Sống Khỏe.
 * Danh sách nằm trong content/videos.json (đưa vào repo => deploy). Thứ tự đăng = thứ tự TẢI LÊN Drive (`createdTime`).
 * Trạng thái từng video (đã hẹn / đã đăng / bị chặn) nằm ở Redis để không đăng lặp.
 */
export interface VideoEntry {
  id: string; // ổn định, ví dụ "viet-duc-suc-khoe-07"
  driveFileId: string;
  fileName: string;
  createdTime: string; // ISO – thời điểm tải lên Drive
  title: string; // tiêu đề (≤ 80 ký tự)
  caption: string; // thân bài, CHƯA gồm cảnh báo/hashtag (hệ thống gắn)
  hashtags: string[];
}

export type VideoState =
  | { status: "scheduled"; slot: string; date: string; fbVideoId: string; at: string }
  | { status: "posted"; fbVideoId: string; permalink?: string; at: string }
  | { status: "blocked"; reason: string; at: string }
  | { status: "retry"; attempts: number; reason: string; at: string };

let override: VideoEntry[] | null = null;
/** Chỉ dùng cho test. */
export function setVideoQueueForTest(q: VideoEntry[] | null) { override = q; }

export function loadQueue(): VideoEntry[] {
  const q = override ?? (queueFile as VideoEntry[]);
  return [...q].sort((a, b) => Date.parse(a.createdTime) - Date.parse(b.createdTime));
}

const key = (id: string) => `video:${id}`;
export const getVideoState = (id: string) => getStore().get<VideoState>(key(id));
export const setVideoState = (id: string, s: VideoState) => getStore().set(key(id), s);
export const clearVideoState = (id: string) => getStore().del(key(id));

/** Video kế tiếp chưa hẹn/đăng/bị chặn, theo thứ tự tải lên. */
export async function pendingVideos(): Promise<VideoEntry[]> {
  const out: VideoEntry[] = [];
  for (const v of loadQueue()) {
    const st = await getVideoState(v.id);
    if (!st || st.status === "retry") out.push(v);
  }
  return out;
}

/**
 * Link tải TRỰC TIẾP từ Google Drive (không qua trang cảnh báo quét virus của file lớn).
 * Yêu cầu: file/thư mục đã chia sẻ "Bất kỳ ai có đường liên kết – Người xem".
 */
export const driveDirectUrl = (fileId: string) =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;

/** Kiểm tra Facebook sẽ tải được video: phải trả về dữ liệu video, không phải trang HTML đăng nhập/cảnh báo. */
export async function checkVideoUrl(url: string): Promise<{ ok: boolean; detail: string; bytes?: number }> {
  if (env("SKIP_IMAGE_CHECK") === "1") return { ok: true, detail: "bỏ qua (test)" };
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-2047" }, redirect: "follow", cache: "no-store" });
    const ct = r.headers.get("content-type") ?? "";
    const cr = r.headers.get("content-range") ?? "";
    const total = Number(cr.split("/")[1]) || Number(r.headers.get("content-length")) || undefined;
    await r.arrayBuffer().catch(() => undefined);
    if (!(r.status === 200 || r.status === 206)) return { ok: false, detail: `HTTP ${r.status} (file chưa chia sẻ công khai?)` };
    if (ct.includes("text/html")) return { ok: false, detail: "Drive trả về trang web thay vì video (file chưa chia sẻ 'bất kỳ ai có link' hoặc bị chặn tải)" };
    if (total !== undefined && total < 100000) return { ok: false, detail: `File quá nhỏ (${total} byte)` };
    return { ok: true, detail: `${ct || "video"}${total ? `, ${(total / 1048576).toFixed(0)} MB` : ""}`, bytes: total };
  } catch (e) {
    return { ok: false, detail: `Không tải được: ${(e as Error).message}` };
  }
}
