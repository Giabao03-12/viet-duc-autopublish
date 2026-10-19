import { env, isMockLLM, isMockMeta } from "./config";
import { approvedClaims, portraitConfirmed } from "./catalog";
import * as meta from "./meta";
import { getStore } from "./store";
import { getSettings, saveSettings } from "./pipeline";

export interface Check { id: string; label: string; ok: boolean; detail: string; blocking: boolean }

export async function runPreflight(): Promise<{ ok: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  const add = (id: string, label: string, ok: boolean, detail: string, blocking = true) => checks.push({ id, label, ok, detail, blocking });

  try {
    const s = getStore();
    await s.set("preflight:ping", Date.now());
    add("store", "Cơ sở dữ liệu", s.kind === "redis", `Đang dùng: ${s.kind}${s.kind !== "redis" ? " (chỉ để chạy thử – chạy thật trên Vercel phải là Redis)" : ""}`);
  } catch (e) { add("store", "Cơ sở dữ liệu", false, (e as Error).message); }

  const hasKey = !!env("ANTHROPIC_API_KEY");
  add("claude", "Claude API", hasKey && !isMockLLM(), isMockLLM() ? "ĐANG DÙNG BẢN GIẢ LẬP (MOCK_LLM=1) – không dùng để kích hoạt thật" : hasKey ? "Có ANTHROPIC_API_KEY" : "Thiếu ANTHROPIC_API_KEY");

  const mock = isMockMeta();
  try {
    const page = await meta.getPage();
    add("page", "Kết nối Fanpage (Graph API)", !mock, mock ? "ĐANG GIẢ LẬP (MOCK_META=1)" : `Đọc được Page: ${page.name} (ID ${page.id})`);
  } catch (e) { add("page", "Kết nối Fanpage (Graph API)", false, (e as Error).message); }

  try {
    const t = await meta.tokenHealth();
    const missing = t.scopes.length ? ["pages_manage_posts"].filter((n) => !t.scopes.includes(n)) : [];
    const detail = mock ? "giả lập" : !t.valid ? `Không hợp lệ: ${t.note ?? ""}` : missing.length ? `Thiếu quyền: ${missing.join(", ")}` : `Hợp lệ (${t.neverExpires ? "không hết hạn" : t.daysLeft === null ? "không rõ hạn" : t.daysLeft + " ngày còn lại"})`;
    add("token", "Token Facebook", t.valid && !missing.length && !mock, detail);
  } catch (e) { add("token", "Token Facebook", false, (e as Error).message); }

  add("baseurl", "PUBLIC_BASE_URL (https)", /^https:\/\//.test(env("PUBLIC_BASE_URL")), env("PUBLIC_BASE_URL") || "Thiếu – Facebook cần URL https công khai để tải ảnh");
  add("cron", "CRON_SECRET", env("CRON_SECRET").length >= 16, env("CRON_SECRET").length >= 16 ? "Đã đặt" : "Cần chuỗi ngẫu nhiên ≥ 16 ký tự");
  add("admin", "ADMIN_PASSWORD / SESSION_SECRET", env("ADMIN_PASSWORD").length >= 10 && env("SESSION_SECRET").length >= 16, "Mật khẩu ≥ 10 ký tự, secret ≥ 16 ký tự");
  const hasNotify = !!(env("NOTIFY_WEBHOOK_URL") || (env("TELEGRAM_BOT_TOKEN") && env("TELEGRAM_CHAT_ID")));
  add("notify", "Kênh thông báo", hasNotify, hasNotify ? "Đã cấu hình" : "Chưa có webhook/Telegram – sẽ không nhận được cảnh báo");
  const claims = approvedClaims();
  add("claims", "Claim đã duyệt (APPROVED_CLAIMS)", claims.length > 0, claims.length ? claims.map((c) => c.id).join(", ") : "Chưa duyệt claim nào – bài 18:00 chỉ dùng chủ đề không nêu công dụng", false);
  add("portrait", "Ảnh chân dung đã xác nhận", portraitConfirmed(), portraitConfirmed() ? "Dùng ảnh thật viet-duc-01" : "Chưa xác nhận (PORTRAIT_CONFIRMED=1) – bài giáo dục tạm không có ảnh người", false);

  const ok = checks.filter((c) => c.blocking).every((c) => c.ok);
  const st = await getSettings();
  st.preflightOkAt = ok ? new Date().toISOString() : undefined;
  await saveSettings(st);
  return { ok, checks };
}
