import { NextResponse } from "next/server";
import { ALL_SLOTS } from "@/lib/config";
import { requireAdmin } from "@/lib/admin";
import { prepareSlot } from "@/lib/pipeline";
import type { SlotId } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Tạo bài nháp (caption + ảnh) và kiểm duyệt, KHÔNG đăng, KHÔNG gọi Meta. */
export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  const { slot } = (await req.json().catch(() => ({}))) as { slot?: string };
  if (!slot || !(ALL_SLOTS as string[]).includes(slot)) return NextResponse.json({ error: `slot phải là một trong: ${ALL_SLOTS.join(", ")}` }, { status: 400 });
  const r = await prepareSlot({ slot: slot as SlotId, dryRun: true });
  return NextResponse.json(r);
}
