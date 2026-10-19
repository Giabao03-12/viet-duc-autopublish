import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { publishTestPost } from "@/lib/pipeline";
import { fold } from "@/lib/compliance";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Đăng NGAY một bản nháp đã đạt kiểm duyệt. Chỉ chạy khi chủ page gõ đúng cụm xác nhận. */
export async function POST(req: Request) {
  const d = requireAdmin(req); if (d) return d;
  const { id, confirm } = (await req.json().catch(() => ({}))) as { id?: string; confirm?: string };
  if (fold(confirm ?? "") !== "dang thu") return NextResponse.json({ error: 'Cần gõ đúng "ĐĂNG THỬ" để xác nhận' }, { status: 400 });
  if (!id) return NextResponse.json({ error: "Thiếu id bài nháp" }, { status: 400 });
  try { return NextResponse.json({ post: await publishTestPost(id) }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
