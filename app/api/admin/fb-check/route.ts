import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { CHANNELS, channelConfigured, env, type ChannelId } from "@/lib/config";
import { checkTokenMatchesPage, inChannel } from "@/lib/meta";
import { listPosts } from "@/lib/pipeline";
import { tokenHealth } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const V = () => env("META_GRAPH_VERSION") || "v22.0";
let TOKEN = "";
async function g(path: string, params: Record<string, string> = {}) {
  const q = new URLSearchParams({ ...params, access_token: TOKEN });
  const r = await fetch(`https://graph.facebook.com/${V()}${path}?${q}`, { cache: "no-store" });
  return (await r.json()) as Record<string, unknown> & { error?: { message: string; code: number } };
}
const vn = (t?: string | number) => {
  if (!t) return "?";
  const d = typeof t === "number" || /^\d+$/.test(String(t)) ? new Date(Number(t) * 1000) : new Date(String(t));
  return d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
};
const short = (s?: unknown) => String(s ?? "").replace(/\s+/g, " ").slice(0, 60);

/** Chẩn đoán Facebook: quyền token, Page, bài đang lên lịch, bài đã đăng gần nhất, bài hệ thống đã hẹn. */
export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  const out: string[] = [];
  for (const ch of Object.keys(CHANNELS) as ChannelId[]) {
    if (!channelConfigured(ch)) { out.push(`=== ${CHANNELS[ch].name}: CHƯA CẤU HÌNH ===`); continue; }
    out.push(`=== ${CHANNELS[ch].name} ===`);
    await inChannel(ch, () => checkOne(ch, out));
  }
  return NextResponse.json({ detail: out });
}

async function checkOne(ch: ChannelId, out: string[]) {
  TOKEN = env(CHANNELS[ch].tokenEnv);
  const pid = env(CHANNELS[ch].pageIdEnv);
  try {
    const t = await tokenHealth();
    out.push(`Token: ${t.valid ? "hợp lệ" : "KHÔNG hợp lệ " + (t.note ?? "")}; quyền: ${t.scopes.join(", ") || "không đọc được"}`);
  } catch (e) { out.push(`Token: lỗi ${(e as Error).message}`); }

  const m = await checkTokenMatchesPage();
  out.push(`${m.ok ? "✅" : "❌"} ${m.detail}`);
  const page = await g(`/${pid}`, { fields: "name,is_published,verification_status" });
  out.push(page.error ? `Page: LỖI ${page.error.code} – ${page.error.message}` : `Page: ${page.name} (công khai: ${page.is_published === false ? "KHÔNG" : "có"})`);

  const sch = await g(`/${pid}/scheduled_posts`, { fields: "id,message,scheduled_publish_time", limit: "10" });
  if (sch.error) out.push(`Bài đang lên lịch: LỖI ${sch.error.code} – ${sch.error.message}`);
  else {
    const data = (sch.data as { id: string; message?: string; scheduled_publish_time?: number }[]) ?? [];
    out.push(`Bài đang lên lịch trên Facebook: ${data.length}`);
    for (const x of data.slice(0, 5)) out.push(`  • ${vn(x.scheduled_publish_time)} – ${short(x.message)}`);
  }

  const pub = await g(`/${pid}/published_posts`, { fields: "id,message,created_time,permalink_url", limit: "5" });
  if (pub.error) out.push(`Bài đã đăng: LỖI ${pub.error.code} – ${pub.error.message}`);
  else {
    const data = (pub.data as { id: string; message?: string; created_time?: string; permalink_url?: string }[]) ?? [];
    out.push(`5 bài đã đăng gần nhất:`);
    for (const x of data) out.push(`  • ${vn(x.created_time)} – ${short(x.message)}${x.permalink_url ? " → " + x.permalink_url : ""}`);
  }

  const mine = (await listPosts(20)).filter((p) => !p.dryRun && p.fbPostId && (p.channel ?? "ktd") === ch).slice(0, 3);
  for (const p of mine) {
    const r = await g(`/${p.fbPostId}`, { fields: "id" });
    out.push(`Hệ thống ${p.date} ${p.slot} [${p.status}] mã ${p.fbPostId}: ${r.error ? "Facebook báo " + r.error.code + " – " + r.error.message : "còn tồn tại"}`);
  }
}
