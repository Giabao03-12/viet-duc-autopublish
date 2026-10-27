import type { SlotId, SlotKind } from "./types";

export const TZ = "Asia/Ho_Chi_Minh"; // UTC+7, không có giờ mùa hè
export const TZ_OFFSET_MIN = 7 * 60;

/** Mỗi kênh = 1 Fanpage, có Page ID + token riêng (biến môi trường). */
export type ChannelId = "ktd" | "sk";
export const CHANNELS: Record<ChannelId, { name: string; pageIdEnv: string; tokenEnv: string; productOffset: number }> = {
  ktd: { name: "Việt Đức - Khoẻ Trẻ Đẹp", pageIdEnv: "META_PAGE_ID", tokenEnv: "META_PAGE_ACCESS_TOKEN", productOffset: 0 },
  // productOffset 1: cùng ngày, Page Sống Khỏe nói về sản phẩm KHÁC với Page Khoẻ Trẻ Đẹp
  sk: { name: "Việt Đức - Sống Khỏe", pageIdEnv: "META_PAGE_ID_SK", tokenEnv: "META_PAGE_ACCESS_TOKEN_SK", productOffset: 1 },
};
export const channelConfigured = (ch: ChannelId) => !!(env(CHANNELS[ch].pageIdEnv) && env(CHANNELS[ch].tokenEnv));

export const SLOTS: Record<SlotId, { hour: number; minute: number; kind: SlotKind; label: string; channel: ChannelId }> = {
  "0600": { hour: 6, minute: 0, kind: "education", channel: "ktd", label: "06:00 Khoẻ Trẻ Đẹp – Giáo dục sức khỏe" },
  "1800": { hour: 18, minute: 0, kind: "product", channel: "ktd", label: "18:00 Khoẻ Trẻ Đẹp – Kiến thức sản phẩm / giải đáp" },
  "0700": { hour: 7, minute: 0, kind: "education", channel: "sk", label: "07:00 Sống Khỏe – Giáo dục sức khỏe" },
  "1900": { hour: 19, minute: 0, kind: "product", channel: "sk", label: "19:00 Sống Khỏe – Kiến thức sản phẩm / giải đáp" },
  // Video đã dựng (hàng chờ content/videos.json, theo thứ tự tải lên Drive) – Page Sống Khỏe
  "0615": { hour: 6, minute: 15, kind: "video", channel: "sk", label: "06:15 Sống Khỏe – Video" },
  "1130": { hour: 11, minute: 30, kind: "video", channel: "sk", label: "11:30 Sống Khỏe – Video" },
  "1930": { hour: 19, minute: 30, kind: "video", channel: "sk", label: "19:30 Sống Khỏe – Video" },
};
export const ALL_SLOTS = Object.keys(SLOTS) as SlotId[];

export const BRAND = {
  name: "Việt Đức – Sống Khỏe",
  handle: "VIỆT ĐỨC • SỐNG KHỎE",
  educationFooter: "Thông tin mang tính tham khảo, không thay thế tư vấn y khoa.",
  // Câu bắt buộc với quảng cáo thực phẩm bảo vệ sức khỏe
  productDisclaimer: "Thực phẩm này không phải là thuốc, không có tác dụng thay thế thuốc chữa bệnh.",
};

// Facebook yêu cầu hẹn giờ cách hiện tại ≥ 10 phút. Dưới ngưỡng này -> bỏ lượt, KHÔNG đăng bù.
export const MIN_LEAD_MIN = 15;
export const MAX_REVISIONS = 3;

export const env = (k: string) => (process.env[k] ?? "").trim();
export const isMockLLM = () => env("MOCK_LLM") === "1";
export const isMockMeta = () => env("MOCK_META") === "1";

/** Ngày + giờ theo múi giờ Việt Nam từ một mốc thời gian. */
export function ictParts(d: Date) {
  const shifted = new Date(d.getTime() + TZ_OFFSET_MIN * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return {
    date: `${y}-${m}-${day}`,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    dayIndex: Math.floor(shifted.getTime() / 86400000), // số ngày kể từ 1970 (giờ VN)
  };
}

/** Mốc UTC của khung giờ `slot` trong ngày VN `date` (YYYY-MM-DD). */
export function slotInstant(date: string, slot: SlotId): Date {
  const [y, m, d] = date.split("-").map(Number);
  const { hour, minute } = SLOTS[slot];
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - TZ_OFFSET_MIN * 60000);
}

/** Lần xuất hiện kế tiếp của khung giờ (kể từ `now`). */
export function nextSlotInstant(now: Date, slot: SlotId): { date: string; at: Date } {
  const today = ictParts(now).date;
  const at = slotInstant(today, slot);
  if (at.getTime() <= now.getTime()) {
    const tomorrow = ictParts(new Date(now.getTime() + 86400000)).date;
    return { date: tomorrow, at: slotInstant(tomorrow, slot) };
  }
  return { date: today, at };
}

/** Tìm đúng chuỗi token Telegram (số:chữ) trong giá trị đã dán, bỏ mọi ký tự thừa. */
export function telegramToken(): string {
  const m = env("TELEGRAM_BOT_TOKEN").match(/\d{6,}:[A-Za-z0-9_-]{35}/);
  return m ? m[0] : "";
}
/** Chat ID: chỉ lấy phần số (có thể có dấu trừ). */
export function telegramChat(): string {
  const m = env("TELEGRAM_CHAT_ID").match(/-?\d{5,}/);
  return m ? m[0] : "";
}
