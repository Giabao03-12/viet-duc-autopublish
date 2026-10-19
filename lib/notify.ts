import { env, telegramChat, telegramToken } from "./config";
import { getStore } from "./store";
import { log } from "./log";

/**
 * Gửi báo cáo/cảnh báo qua webhook (Zapier -> Gmail) và/hoặc Telegram.
 * Cảnh báo cùng loại (`dedupeKey`) không gửi lặp trong 6 giờ.
 */
export async function notify(level: "info" | "warn" | "error", subject: string, text: string, dedupeKey?: string) {
  if (dedupeKey) {
    try {
      const ok = await getStore().setnx(`alert:${dedupeKey}`, Date.now(), 6 * 3600);
      if (!ok) return;
    } catch { /* nếu store lỗi vẫn gửi */ }
  }
  const prefix = level === "error" ? "🔴" : level === "warn" ? "🟠" : "🟢";
  const title = `${prefix} [Việt Đức Auto] ${subject}`;
  let sent = 0;
  const hook = env("NOTIFY_WEBHOOK_URL");
  if (hook) {
    try {
      const r = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level, subject: title, text, at: new Date().toISOString() }) });
      if (r.ok) sent++;
    } catch (e) { console.error("webhook notify failed", e); }
  }
  const tg = telegramToken(), chat = telegramChat();
  if (tg && chat) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: `${title}\n\n${text}`.slice(0, 4000) }) });
      if (r.ok) sent++;
    } catch (e) { console.error("telegram notify failed", e); }
  }
  if (!sent) await log("warn", "notify", `Chưa cấu hình kênh thông báo (hoặc gửi lỗi): ${title}`);
}
