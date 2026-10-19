import { createHmac, timingSafeEqual } from "crypto";
import { env } from "./config";

/** Cron: Vercel tự gửi "Authorization: Bearer $CRON_SECRET". */
export function isCron(req: Request): boolean {
  const secret = env("CRON_SECRET");
  if (!secret) return false;
  const h = req.headers.get("authorization") ?? "";
  return safeEq(h, `Bearer ${secret}`);
}

function safeEq(a: string, b: string) {
  const A = Buffer.from(a), B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

const sign = (v: string) => createHmac("sha256", env("SESSION_SECRET") || "dev-secret").update(v).digest("hex");

export function makeSession(): string {
  const exp = String(Date.now() + 7 * 86400000);
  return `${exp}.${sign(exp)}`;
}

export function checkPassword(p: string): boolean {
  const real = env("ADMIN_PASSWORD");
  return !!real && safeEq(p, real);
}

export function isAdmin(req: Request): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(/(?:^|;\s*)vd_session=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEq(sig, sign(exp));
}
