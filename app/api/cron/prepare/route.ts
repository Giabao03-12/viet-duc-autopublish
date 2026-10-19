import { NextResponse } from "next/server";
import { isCron } from "@/lib/auth";
import { prepareSlot } from "@/lib/pipeline";
import { notify } from "@/lib/notify";
import type { SlotId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCron(req)) return new NextResponse("unauthorized", { status: 401 });
  const slot = new URL(req.url).searchParams.get("slot");
  if (slot !== "0600" && slot !== "1800") return NextResponse.json({ error: "slot phải là 0600 hoặc 1800" }, { status: 400 });
  try {
    const r = await prepareSlot({ slot: slot as SlotId });
    return NextResponse.json({ status: r.status, reason: r.reason, postId: r.post?.id, fbPostId: r.post?.fbPostId });
  } catch (e) {
    await notify("error", "Cron chuẩn bị bài bị lỗi", (e as Error).message, `cron-crash:${slot}`);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
