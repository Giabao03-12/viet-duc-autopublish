import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { runPreflight } from "@/lib/preflight";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  return NextResponse.json(await runPreflight());
}
