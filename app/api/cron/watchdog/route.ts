import { NextResponse } from "next/server";
import { isCron } from "@/lib/auth";
import { watchdog } from "@/lib/pipeline";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCron(req)) return new NextResponse("unauthorized", { status: 401 });
  try {
    return NextResponse.json({ report: await watchdog() });
  } catch (e) {
    await notify("error", "Watchdog bị lỗi", (e as Error).message, "watchdog-crash");
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
