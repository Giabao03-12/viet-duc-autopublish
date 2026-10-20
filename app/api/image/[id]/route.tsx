import { ImageResponse } from "next/og";
import { promises as fs } from "fs";
import path from "path";
import { BRAND } from "@/lib/config";
import { portraitConfirmed, productById } from "@/lib/catalog";
import { getPost } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const A = (...p: string[]) => path.join(process.cwd(), "assets", ...p);
const dataUri = async (file: string) => `data:image/${/\.jpe?g$/i.test(file) ? "jpeg" : "png"};base64,${(await fs.readFile(file)).toString("base64")}`;

/**
 * Ảnh bài đăng 1080×1350, theo bộ nhận diện Việt Đức – Sống Khỏe (vàng / đỏ / đen).
 * Ảnh sản phẩm và chân dung là ẢNH THẬT, chỉ đặt vào khung – không vẽ lại, không chỉnh khuôn mặt hay bao bì.
 * Không dùng AI sinh ảnh cho người/sản phẩm.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: raw } = await ctx.params;
  const post = await getPost(raw.replace(/\.png$/, ""));
  if (!post) return new Response("not found", { status: 404 });

  const [bold, regular] = await Promise.all([fs.readFile(A("fonts", "BeVietnamPro-Bold.ttf")), fs.readFile(A("fonts", "BeVietnamPro-Regular.ttf"))]);
  const product = post.productId ? productById(post.productId) : undefined;
  const isProduct = post.kind === "product" && !!product;

  let photo: string | null = null;
  if (isProduct) photo = await dataUri(A("products", product!.image.replace(".png", "-web.png")));
  // Ảnh chân dung do chính Việt Đức gửi và xác nhận (20/10/2026); chỉ cắt khung + thu nhỏ, không chỉnh mặt.
  else if (portraitConfirmed()) photo = await dataUri(A("portraits", "viet-duc-confirmed.jpg"));

  const title = post.title;
  const fontSize = title.length > 60 ? 62 : title.length > 40 ? 72 : 84;
  const footer = isProduct ? BRAND.productDisclaimer : BRAND.educationFooter;
  // Khi chưa có ảnh người đã xác nhận: dùng câu mở bài làm điểm nhấn thay vì để trống
  const hook = (post.caption.split("\n\n")[1] ?? "").split(/(?<=[.!?])\s/)[0].slice(0, 160);

  return new ImageResponse(
    (
      <div style={{ width: 1080, height: 1350, display: "flex", flexDirection: "column", fontFamily: "BeVietnam", background: isProduct ? "#FFFFFF" : "linear-gradient(160deg,#FFD400,#FFB800)" }}>
        <div style={{ display: "flex", background: isProduct ? "#C8102E" : "#111111", color: isProduct ? "#FFFFFF" : "#FFD400", fontSize: 34, fontWeight: 700, padding: "28px 70px", letterSpacing: 4 }}>
          {BRAND.handle}
        </div>
        <div style={{ display: "flex", flexDirection: "column", padding: "70px 70px 0 70px", flexGrow: 0 }}>
          <div style={{ display: "flex", fontSize, lineHeight: 1.18, fontWeight: 700, color: isProduct ? "#111111" : "#111111" }}>{title}</div>
          <div style={{ display: "flex", width: 180, height: 12, background: "#C8102E", marginTop: 34 }} />
        </div>
        <div style={{ display: "flex", flexGrow: 1, alignItems: "center", justifyContent: isProduct ? "center" : "space-between", padding: "20px 70px" }}>
          {photo && isProduct ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" style={{ height: 640, objectFit: "contain" }} />
          ) : photo ? (
            <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", width: 380, fontSize: 38, lineHeight: 1.35, color: "#111111", background: "rgba(255,255,255,0.6)", borderLeft: "12px solid #C8102E", padding: "28px 30px" }}>{hook || post.topicLabel}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="" style={{ height: 640, width: 549, objectFit: "cover", borderRadius: 24, border: "8px solid #FFFFFF" }} />
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 44, lineHeight: 1.35, color: "#111111", background: "rgba(255,255,255,0.55)", borderLeft: "14px solid #C8102E", padding: "34px 40px", width: "100%" }}>{hook || post.topicLabel}</div>
          )}
        </div>
        <div style={{ display: "flex", background: "#111111", color: "#FFFFFF", fontSize: 26, padding: "26px 70px", lineHeight: 1.35 }}>{footer}</div>
      </div>
    ),
    {
      width: 1080,
      height: 1350,
      fonts: [
        { name: "BeVietnam", data: bold, weight: 700, style: "normal" },
        { name: "BeVietnam", data: regular, weight: 400, style: "normal" },
      ],
      headers: { "Cache-Control": "public, max-age=3600" },
    },
  );
}
