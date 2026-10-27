/** Kiểm duyệt caption trong content/videos.json bằng bộ luật của hệ thống. Chạy: npx tsx scripts/check-videos.ts */
import { checkContent } from "../lib/compliance";
import { loadQueue } from "../lib/videos";

let bad = 0;
for (const v of loadQueue()) {
  const r = checkContent({ kind: "education", title: v.title, body: v.caption, hashtags: v.hashtags, approved: [], allowedClaimIds: [], recentCaptions: [] });
  console.log(`${r.pass ? "ĐẠT " : "LỖI "} ${v.fileName}  (thân bài ${v.caption.length} ký tự, tiêu đề ${v.title.length})`);
  for (const i of r.issues) console.log("   - " + i);
  if (!r.pass) bad++;
}
process.exit(bad ? 1 : 0);
