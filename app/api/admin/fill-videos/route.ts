import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { fillVideoSlots, resetVideoSchedule } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hẹn giờ NGAY các video chưa lên lịch vào các khung video sắp tới, theo thứ tự tải lên. reset=true: huỷ lịch video cũ rồi xếp lại. */
export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  const { reset } = (await req.json().catch(() => ({}))) as { reset?: boolean };
  const report: string[] = reset ? await resetVideoSchedule() : [];
  return NextResponse.json({ report: [...report, ...(await fillVideoSlots())] });
}
