import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getSettings, listPosts } from "@/lib/pipeline";
import { getStore } from "@/lib/store";
import { approvedClaims } from "@/lib/catalog";
import { tokenHealth } from "@/lib/meta";
import type { LogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  const [settings, posts, logs, hb, token] = await Promise.all([
    getSettings(), listPosts(30), getStore().lrange<LogEntry>("log", 0, 59),
    getStore().get<{ at: string; report: string[] }>("heartbeat"),
    tokenHealth().catch((e) => ({ valid: false, note: (e as Error).message })),
  ]);
  return NextResponse.json({ settings, posts, logs, heartbeat: hb, token, approvedClaims: approvedClaims().map((c) => c.id), store: getStore().kind });
}
