import { NextResponse } from "next/server";
import { isAdmin } from "./auth";

export const denied = () => NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
export const requireAdmin = (req: Request) => (isAdmin(req) ? null : denied());
