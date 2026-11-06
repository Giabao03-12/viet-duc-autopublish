// Kiểm tra render bài nhiều ảnh (thẻ chữ + 2 ảnh thật): npx tsx scripts/render-check.ts <thư mục xuất>
import { promises as fs } from "fs";
import path from "path";
import { savePost } from "../lib/pipeline";
import React from "react";
import type { Post } from "../lib/types";

const out = process.argv[2] ?? ".";
const post = {
  id: "render-check", slot: "1900", channel: "sk", kind: "product", date: "2026-11-06", publishAt: new Date().toISOString(), status: "draft", dryRun: true,
  productId: "rich", topicId: "t", topicLabel: "t", titles: [], title: "Ai không nên tự dùng RICH?", caption: "", hashtags: [], claimIds: [],
  imageKind: "product", photos: ["rich-1.jpg", "rich-2.jpg"], attempts: 0, complianceLog: [], createdAt: "", updatedAt: "",
} as Post;

(async () => {
  (globalThis as unknown as { React: unknown }).React = React; // tsx không tự thêm React như Next
  const { GET } = await import("../app/api/image/[id]/route");
  await savePost(post);
  for (const part of ["card", "a", "b"]) {
    const r = await GET(new Request(`http://x/api/image/render-check.png?part=${part}`), { params: Promise.resolve({ id: "render-check.png" }) });
    const buf = Buffer.from(await r.arrayBuffer());
    await fs.writeFile(path.join(out, `render-${part}.png`), buf);
    console.log(part, r.status, buf.length);
  }
})();
