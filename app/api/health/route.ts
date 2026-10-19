import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { getSettings } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Dùng cho dịch vụ giám sát bên ngoài (UptimeRobot/BetterStack): trả 503 nếu hệ thống
 * đang BẬT mà watchdog không chạy quá 20 giờ. Đây là cách duy nhất báo được khi chính Vercel/cron ngừng.
 */
export async function GET() {
  try {
    const s = await getSettings();
    const hb = await getStore().get<{ at: string }>("heartbeat");
    const ageH = hb ? (Date.now() - Date.parse(hb.at)) / 3600000 : null;
    const stale = s.autoEnabled && (ageH === null || ageH > 20);
    return NextResponse.json({ ok: !stale, autoEnabled: s.autoEnabled, heartbeatHoursAgo: ageH }, { status: stale ? 503 : 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 503 });
  }
}
