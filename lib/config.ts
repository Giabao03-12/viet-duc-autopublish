import type { SlotId, SlotKind } from "./types";

export const TZ = "Asia/Ho_Chi_Minh"; // UTC+7, không có giờ mùa hè
export const TZ_OFFSET_MIN = 7 * 60;

export const SLOTS: Record<SlotId, { hour: number; minute: number; kind: SlotKind; label: string }> = {
  "0600": { hour: 6, minute: 0, kind: "education", label: "06:00 – Giáo dục sức khỏe" },
  "1800": { hour: 18, minute: 0, kind: "product", label: "18:00 – Kiến thức sản phẩm / giải đáp" },
};

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
