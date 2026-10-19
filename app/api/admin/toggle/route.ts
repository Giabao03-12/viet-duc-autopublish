import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { cancelScheduled, getSettings, saveSettings } from "@/lib/pipeline";
import { log } from "@/lib/log";
import { notify } from "@/lib/notify";
import { fold } from "@/lib/compliance";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  const { enable, confirm } = (await req.json().catch(() => ({}))) as { enable?: boolean; confirm?: string };
  const s = await getSettings();

  if (enable) {
    if (fold(confirm ?? "") !== "kich hoat") return NextResponse.json({ error: 'Cần gõ đúng "KÍCH HOẠT" để xác nhận' }, { status: 400 });
    if (!s.preflightOkAt) return NextResponse.json({ error: "Chưa chạy kiểm tra hệ thống (preflight) đạt" }, { status: 400 });
    if (!s.testPostOkAt) return NextResponse.json({ error: "Chưa có bài đăng thử thành công được chủ page cho phép" }, { status: 400 });
    s.autoEnabled = true; s.updatedAt = new Date().toISOString(); s.updatedBy = "admin";
    await saveSettings(s);
    await log("info", "toggle", "BẬT đăng tự động");
    await notify("info", "Đã BẬT đăng tự động", "Lịch: 06:00 và 18:00 mỗi ngày (giờ Việt Nam).");
    return NextResponse.json({ settings: s });
  }

  s.autoEnabled = false; s.updatedAt = new Date().toISOString(); s.updatedBy = "admin";
  await saveSettings(s);
  const cancelled = await cancelScheduled();
  await log("warn", "toggle", `TẮT đăng tự động, huỷ ${cancelled} bài đã hẹn`);
  await notify("warn", "Đã TẮT đăng tự động", `Đã huỷ ${cancelled} bài đã hẹn giờ trên Facebook.`);
  return NextResponse.json({ settings: s, cancelled });
}
