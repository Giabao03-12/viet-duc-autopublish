import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { env, telegramChat, telegramToken } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Gửi tin thử và trả về kết quả CHI TIẾT từng kênh (không lộ token). */
export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  const out: string[] = [];
  const rawTg = env("TELEGRAM_BOT_TOKEN"), tg = telegramToken(), chat = telegramChat(), hook = env("NOTIFY_WEBHOOK_URL");
  out.push(`TELEGRAM_BOT_TOKEN: ${!rawTg ? "TRỐNG/chưa có" : tg ? `đã đọc được token (giá trị dán dài ${rawTg.length} ký tự${rawTg.length !== tg.length ? ", có ký tự thừa đã tự bỏ" : ""}; token đúng dài ${tg.length}, bắt đầu bằng ${tg.split(":")[0]})` : `KHÔNG tìm thấy token dạng số:chữ trong giá trị đã dán (dài ${rawTg.length} ký tự)`}`);
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
