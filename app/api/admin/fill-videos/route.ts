import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { fillVideoSlots } from "@/lib/pipeline";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hẹn giờ NGAY các video chưa lên lịch vào các khung video sắp tới, theo thứ tự tải lên. */
export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  return NextResponse.json({ report: await fillVideoSlots() });
}
