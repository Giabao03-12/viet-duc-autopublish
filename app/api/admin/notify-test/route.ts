import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { notify } from "@/lib/notify";

export const dynamic = "force-dynamic";

/** Gửi một tin thử tới kênh thông báo (Telegram/webhook) để chủ page kiểm tra đã nhận được chưa. */
export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  await notify("info", "Tin thử", "Nếu bạn đọc được tin này, kênh thông báo đã hoạt động.");
  return NextResponse.json({ ok: true });
}
