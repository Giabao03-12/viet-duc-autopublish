import { NextResponse } from "next/server";
import { checkPassword, makeSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!(process.env.ADMIN_PASSWORD ?? "").trim()) return NextResponse.json({ error: "Máy chủ chưa có biến ADMIN_PASSWORD (hoặc đang để trống). Thêm trên Vercel rồi Redeploy." }, { status: 503 });
  if (!password || !checkPassword(password)) return NextResponse.json({ error: "Sai mật khẩu" }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("vd_session", makeSession(), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 7 * 86400 });
  return res;
}
