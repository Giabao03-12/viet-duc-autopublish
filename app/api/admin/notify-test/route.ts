import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { env } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Gửi tin thử và trả về kết quả CHI TIẾT từng kênh (không lộ token). */
export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  const out: string[] = [];
  const tg = env("TELEGRAM_BOT_TOKEN"), chat = env("TELEGRAM_CHAT_ID"), hook = env("NOTIFY_WEBHOOK_URL");
  out.push(`TELEGRAM_BOT_TOKEN: ${tg ? `có (${tg.length} ký tự, ${/^\d+:[\w-]+$/.test(tg) ? "đúng dạng" : "SAI DẠNG – phải là số:chữ, không dấu cách"})` : "TRỐNG/chưa có"}`);
  out.push(`TELEGRAM_CHAT_ID: ${chat ? `có (${chat})` : "TRỐNG/chưa có"}`);
  if (tg && chat) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${tg}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: "🟢 [Việt Đức Auto] Tin thử: kênh thông báo hoạt động." }) });
      const j = (await r.json()) as { ok?: boolean; description?: string };
      out.push(r.ok && j.ok ? "Telegram: ĐÃ GỬI – hãy kiểm tra điện thoại" : `Telegram TỪ CHỐI (${r.status}): ${j.description ?? "không rõ"}`);
    } catch (e) { out.push(`Telegram lỗi mạng: ${(e as Error).message}`); }
  }
  if (hook) out.push("Webhook: đã cấu hình");
  return NextResponse.json({ ok: out.some((l) => l.includes("ĐÃ GỬI")), detail: out });
}
