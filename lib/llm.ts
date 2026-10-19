import Anthropic from "@anthropic-ai/sdk";
import { env, isMockLLM } from "./config";
import type { Claim, Product, Topic } from "./catalog";
import type { SlotKind } from "./types";

export interface Draft {
  audience: string; // phân tích khách hàng mục tiêu (ngắn)
  titles: string[]; // 3 tiêu đề
  chosenIndex: number;
  chosenReason: string;
  body: string; // thân bài (chưa gồm cảnh báo bắt buộc)
  hashtags: string[];
}

export interface DraftContext {
  kind: SlotKind;
  topic: Topic;
  product?: Product;
  claims: Claim[]; // claim ĐƯỢC PHÉP dùng cho chủ đề này (đã duyệt)
  dateLabel: string;
}

const SYSTEM = `Bạn là copywriter của fanpage "Việt Đức – Sống Khỏe" (người đại diện: anh Việt Đức), viết cho người Việt trung niên – cao tuổi.
Phong cách: kết hợp David Ogilvy và Philip Kotler.
- Ogilvy: tiêu đề cụ thể, nói thẳng lợi ích thực tế cho người đọc; văn xuôi rõ ràng, trung thực, tôn trọng trí tuệ người đọc; không giật gân, không hô hào; mỗi câu có việc để làm.
- Kotler: xác định đúng nhóm khách hàng mục tiêu, nỗi bận tâm thật của họ, giá trị mang lại; dẫn dắt theo 5A (Biết – Hấp dẫn – Hỏi – Hành động – Giới thiệu) bằng lời mời nhẹ nhàng (bình luận, lưu bài, hỏi thầy thuốc), KHÔNG chốt đơn.
Giọng: ấm áp, gần gũi, xưng "mình"/"anh chị", câu ngắn, xuống dòng thoáng, tối đa 2–3 emoji.

QUY TẮC CỨNG (vi phạm là bài bị loại):
1. Không cam kết/ám chỉ chữa khỏi bệnh; không dùng "chữa", "đặc trị", "khỏi hẳn", "100%", "cam kết".
2. Không nói thay thế thuốc, ngưng thuốc, chẩn đoán, kê đơn, điều trị.
3. Không tự tạo chứng nhận, nghiên cứu, số liệu, phần trăm, lời bác sĩ/khách hàng.
4. Không nêu giá, khuyến mãi, ưu đãi.
5. Không đưa công dụng nào ngoài các CLAIM ĐƯỢC PHÉP (nếu có). Khi nhắc công dụng sản phẩm, trích NGUYÊN VĂN claim, không diễn đạt lại, không thêm.
6. Không viết phần cảnh báo/"không phải là thuốc"/số xác nhận quảng cáo – hệ thống tự gắn ở cuối bài.
7. Tiếng Việt chuẩn, đủ dấu, đúng chính tả.
Chỉ trả về MỘT đối tượng JSON, không kèm văn bản nào khác.`;

function userPrompt(ctx: DraftContext) {
  const lines: string[] = [];
  lines.push(`Ngày đăng: ${ctx.dateLabel}.`);
  lines.push(`Loại bài: ${ctx.kind === "education" ? "GIÁO DỤC SỨC KHỎE (06:00) – tuyệt đối KHÔNG nhắc tên sản phẩm, thành phần, hay kêu gọi mua" : "KIẾN THỨC SẢN PHẨM / GIẢI ĐÁP (18:00)"}.`);
  lines.push(`Chủ đề: ${ctx.topic.label}\nGóc tiếp cận: ${ctx.topic.angle}`);
  if (ctx.product) {
    lines.push(`Sản phẩm: ${ctx.product.name} (viết đúng tên này, ít nhất 1 lần).\nĐối tượng gợi ý: ${ctx.product.audienceHint}`);
    if (ctx.claims.length) {
      lines.push("CLAIM ĐƯỢC PHÉP (trích nguyên văn, mỗi claim đặt trong MỘT câu riêng, không thêm công dụng khác):\n" + ctx.claims.map((c) => `- ${c.text}`).join("\n"));
    } else {
      lines.push("Chủ đề này KHÔNG được nêu bất kỳ công dụng nào của sản phẩm. Chỉ nói về cách đọc nhãn, đối tượng cần hỏi thầy thuốc, lối sống. Câu nào nhắc sản phẩm thì không dùng các từ 'giúp', 'hỗ trợ', 'cải thiện', 'giảm', 'tăng', 'bảo vệ'.");
    }
  }
  lines.push(`Yêu cầu JSON: {"audience": "1–2 câu phân tích khách hàng mục tiêu và nỗi bận tâm", "titles": ["tiêu đề 1","tiêu đề 2","tiêu đề 3"], "chosenIndex": 0, "chosenReason": "vì sao chọn", "body": "thân bài 300–1100 ký tự, xuống dòng bằng \\n", "hashtags": ["#VietDucSongKhoe", "#..."]}
- 3 tiêu đề phải khác hẳn nhau, mỗi tiêu đề ≤ 70 ký tự.
- Thân bài: mở bằng 1 câu hook, 3–5 ý ngắn, kết bằng lời mời hành động nhẹ nhàng. 2–5 hashtag, không dấu cách trong hashtag.`);
  return lines.join("\n\n");
}

function extractJson<T>(text: string): T {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`Phản hồi AI không có JSON. Đầu phản hồi: "${text.trim().slice(0, 160).replace(/\s+/g, " ")}"`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}

let client: Anthropic | null = null;
async function ask(system: string, user: string, maxTokens = 12000): Promise<string> {
  if (!env("ANTHROPIC_API_KEY")) throw new Error("Thiếu ANTHROPIC_API_KEY");
  client ??= new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
  const res = await client.messages.create({
    model: env("ANTHROPIC_MODEL") || "claude-sonnet-5-5",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  if (!text.trim()) throw new Error(`AI trả về rỗng (stop_reason=${res.stop_reason}, loại khối=${res.content.map((c) => c.type).join(",") || "không có"}, model=${res.model})`);
  return text;
}

function sanitize(d: Draft): Draft {
  return {
    audience: String(d.audience ?? ""),
    titles: (d.titles ?? []).map(String),
    chosenIndex: Number.isInteger(d.chosenIndex) ? d.chosenIndex : 0,
    chosenReason: String(d.chosenReason ?? ""),
    body: String(d.body ?? "").replace(/\r/g, "").trim(),
    hashtags: (d.hashtags ?? []).map((h) => String(h).replace(/\s+/g, "")),
  };
}

export async function writeDraft(ctx: DraftContext): Promise<Draft> {
  if (isMockLLM()) return mockDraft(ctx);
  return sanitize(extractJson<Draft>(await ask(SYSTEM, userPrompt(ctx))));
}

export async function reviseDraft(ctx: DraftContext, prev: Draft, issues: string[]): Promise<Draft> {
  if (isMockLLM()) return mockDraft(ctx, true);
  const user = `${userPrompt(ctx)}\n\n---\nBẢN TRƯỚC (bị loại):\n${JSON.stringify(prev)}\n\nLỖI CẦN SỬA (sửa TẤT CẢ, giữ nguyên chủ đề, cùng định dạng JSON):\n${issues.map((i) => `- ${i}`).join("\n")}`;
  return sanitize(extractJson<Draft>(await ask(SYSTEM, user)));
}

/** Lớp kiểm tra thứ hai bằng AI: chính tả + đối chiếu hồ sơ. Luật cứng ở compliance.ts vẫn là chốt chặn chính. */
export async function reviewDraft(ctx: DraftContext, title: string, body: string): Promise<{ pass: boolean; issues: string[] }> {
  if (isMockLLM()) return { pass: true, issues: [] };
  const sys = `Bạn là biên tập viên kiểm duyệt nội dung quảng cáo thực phẩm bảo vệ sức khỏe tại Việt Nam. Kiểm tra bản nháp theo 4 mục: (1) lỗi chính tả/ngữ pháp tiếng Việt; (2) thông tin sản phẩm có khớp hồ sơ được cung cấp không; (3) có công dụng/cam kết/số liệu/chứng nhận nào NGOÀI hồ sơ không; (4) có nguy cơ vi phạm quy định quảng cáo TPBVSK không (hứa chữa bệnh, thay thế thuốc, lời chứng thực...). Khắt khe. Trả về DUY NHẤT JSON {"pass": boolean, "issues": ["..."]}.`;
  const facts = ctx.product
    ? `Hồ sơ: sản phẩm ${ctx.product.name}. Claim được phép: ${ctx.claims.map((c) => `"${c.text}"`).join("; ") || "(không có – không được nêu công dụng)"}.`
    : "Bài giáo dục: không được nhắc sản phẩm, không nêu công dụng sản phẩm.";
  const out = extractJson<{ pass: boolean; issues: string[] }>(await ask(sys, `${facts}\n\nTiêu đề: ${title}\n\nThân bài:\n${body}`, 10000));
  return { pass: !!out.pass, issues: (out.issues ?? []).map(String) };
}

/** Bản giả lập có kiểm soát để chạy thử toàn bộ quy trình khi chưa có API key. KHÔNG dùng để đăng thật. */
function mockDraft(ctx: DraftContext, fixed = false): Draft {
  const t = ctx.topic.label;
  const name = ctx.product?.name ?? "";
  const claimSentences = ctx.claims.map((c) => c.text).join("\n");
  const short = t.length > 48 ? t.slice(0, 48).trim() : t;
  const body =
    ctx.kind === "education"
      ? `Chủ đề hôm nay: ${t}.\n\n${ctx.topic.angle}\n\nMỗi người một thể trạng khác nhau, nên anh chị hãy lắng nghe cơ thể mình về "${t.toLowerCase()}" và làm từ từ, đều đặn. Nếu có điều gì băn khoăn, hãy trao đổi với bác sĩ của anh chị. Anh chị đang áp dụng điều gì trong chủ đề này? Chia sẻ ở phần bình luận để mọi người cùng tham khảo nhé.`
      : `Câu hỏi nhiều anh chị gửi về: ${t}.\n\n${ctx.topic.angle}\n\n${claimSentences ? claimSentences + "\n\n" : ""}Với ${name}, anh chị nên đọc kỹ nhãn trên hộp, xem hạn dùng và mục lưu ý trước khi dùng. Anh chị còn thắc mắc gì về "${t.toLowerCase()}"? Để lại bình luận, mình sẽ giải đáp từng câu.`;
  return {
    audience: "Người trung niên – cao tuổi quan tâm sức khỏe hằng ngày (bản giả lập).",
    titles: [`${short}: điều nên biết${fixed ? " (sửa)" : ""}`, `Hỏi nhanh – đáp gọn: ${short.slice(0, 30)}`, `Anh chị đã biết điều này chưa? ${short.slice(0, 20)}`],
    chosenIndex: 0,
    chosenReason: "Cụ thể, nói thẳng điều người đọc nhận được (bản giả lập).",
    body,
    hashtags: ["#VietDucSongKhoe", "#SucKhoeMoiNgay", "#ChamSocBanThan"],
  };
}
