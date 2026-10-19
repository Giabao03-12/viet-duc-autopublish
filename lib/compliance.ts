import { FOREIGN_PRODUCT_CUES, type Claim, type Product, PRODUCTS } from "./catalog";
import type { SlotKind } from "./types";

/**
 * Kiểm duyệt bằng luật (mang tính chặn cứng, không phụ thuộc AI).
 * Đây là lớp an toàn kỹ thuật dựa trên Claim Registry của Việt Đức; KHÔNG phải ý kiến pháp lý.
 * Nội dung quảng cáo TPBVSK vẫn phải khớp Giấy xác nhận nội dung quảng cáo đang lưu hành.
 */

/** Bỏ dấu, hạ chữ thường – để bắt các biến thể gõ dấu khác nhau. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface Rule { id: string; re: RegExp; why: string; raw?: boolean }

/** Chạy trên văn bản đã `fold`. */
const HARD_RULES: Rule[] = [
  { id: "cure", re: /\b(chua khoi|chua dut|khoi han|khoi benh|het benh|het dau|diet tan|dac tri|dut diem|than duoc|ky tich)\b/, why: "Cam kết/ám chỉ chữa khỏi bệnh" },
  { id: "promise", re: /\b(cam ket|bao dam (khoi|hieu qua|ket qua)|chac chan (khoi|hieu qua)|vinh vien|tuyet doi (an toan|hieu qua)|100\s?%)/, why: "Hứa hẹn/bảo đảm kết quả" },
  { id: "cartilage", re: /\b(tai tao|tai sinh|moc lai|phuc hoi|sua chua)\b.{0,15}\bsun\b|\bsun\b.{0,15}\b(tai tao|tai sinh|moc lai|phuc hoi)/, why: "Claim 'tái tạo/phục hồi sụn' bị chặn (BLOCK-01/13/17)" },
  { id: "stroke", re: /dot quy|tai bien|huyet khoi|nhoi mau co tim|suy tim|loang xuong|thoat vi|dau thanh kinh/, why: "Nhắc bệnh/biến chứng nghiêm trọng ngoài hồ sơ công bố (BLOCK-10/11/15/20–24)" },
  { id: "treat", re: /(?<!khong )(?<!khong nham muc dich )(?<!dang )(?<!hoac )dieu tri|(?<!khong )chan doan|ke don/, why: "Nói về điều trị/chẩn đoán" },
  // Chạy trên chữ CÓ DẤU: sau khi bỏ dấu, "thầy thuốc" sẽ giống "thay thuốc".
  { id: "replace-med", raw: true, re: /(?<!không có tác dụng )(?<!không )(?<!và không )thay thế thuốc|(?<!thầy )(?<!thày )thay thuốc|bỏ thuốc|ngưng thuốc|ngừng thuốc|ngưng điều trị|ngừng điều trị|giảm liều|tự ý (bỏ|ngưng|ngừng)|(?<!thuốc )kê đơn/, why: "Gợi ý thay/ngưng thuốc" },
  { id: "evidence", re: /\b(chung nhan|chung minh|nghien cuu|lam sang|bang sang che|cong trinh|khoa hoc cho thay|giai thuong|hang dau|so 1|tot nhat|hieu qua nhat|duoc bo y te|bac si khuyen|chuyen gia khuyen|chuyen gia cong nhan)\b/, why: "Tự nêu chứng nhận/bằng chứng khoa học/đảm bảo bên thứ ba" },
  { id: "stat", re: /\d+\s?%|\d+\s?(nguoi|khach|benh nhan)\s+(da|deu|khong)/, why: "Số liệu/thống kê không có nguồn" },
  { id: "price", re: /\d[\d.,]*\s?(d|dong|vnd|k|nghin|ngan|trieu|tr)\b|\b(giam gia|khuyen mai|uu dai|mua \d+ tang|tang kem|gia (ban|le|goc|re|tot|chi)|freeship|chot don|inbox bao gia)\b/, why: "Không được tự nêu/đổi giá, khuyến mãi" },
  { id: "testimonial", re: /\b(khach (hang )?(da )?(khoi|het|noi rang)|chi [a-z]+ (da )?(khoi|het)|bac [a-z]+ (da )?(khoi|het)|truoc va sau)\b/, why: "Lời chứng thực chưa có sự đồng ý được ghi nhận (CUSTOMER_REPORT)" },
  { id: "fear", re: /\b(liet nua nguoi|nam liet|co the tu vong|chet nguoi|dang so)\b/, why: "Dùng nỗi sợ bệnh tật để bán hàng (trái giá trị thương hiệu)" },
];

/** Cụm câu chuẩn/khuyến cáo an toàn – được phép, loại ra trước khi quét để không bắt nhầm. */
const SAFE_PHRASES: RegExp[] = [
  /không (phải )?(là )?(nhằm )?(mục đích |dùng để |để |có tác dụng )?(chẩn đoán|điều trị|phòng ngừa|phòng bệnh)([ ,\/]+(hoặc |và )?(chẩn đoán|điều trị|phòng ngừa|phòng bệnh))*( bệnh tật| bệnh)?/g,
  /(không|đừng|chớ)( nên| được)?( tự)?( ý)? (bỏ|ngưng|ngừng|giảm) (thuốc|liều|điều trị)/g,
  /không (có tác dụng )?thay thế (thuốc|tư vấn|bác sĩ|thầy thuốc)( chữa bệnh)?/g,
  /(đang|hoặc|người|bệnh) (đang )?điều trị/g,
  /thuốc kê đơn|đơn thuốc/g,
];
const stripSafe = (t: string) => SAFE_PHRASES.reduce((acc, re) => acc.replace(re, " "), t.normalize("NFC").toLowerCase());

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

const EFFICACY_CUE = /\b(ho tro|giup|tot cho|cai thien|giam|tang|bao ve|chong|duy tri|phuc hoi|lam cham|ngan ngua)\b/;

function emojiCount(s: string) {
  return (s.match(/\p{Extended_Pictographic}/gu) ?? []).length;
}

export interface CheckInput {
  kind: SlotKind;
  title: string;
  body: string; // phần thân bài do AI viết (CHƯA gồm phần cảnh báo do hệ thống gắn)
  hashtags: string[];
  product?: Product;
  approved: Claim[]; // claim đã duyệt
  allowedClaimIds: string[]; // claim mà chủ đề này được phép dùng
  recentCaptions: string[]; // để chống trùng nội dung
  titles?: string[];
}

export interface CheckResult { pass: boolean; issues: string[]; usedClaimIds: string[] }

function trigrams(s: string): Set<string> {
  const w = fold(s).replace(/[^a-z0-9 ]/g, "").split(" ").filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(" "));
  return out;
}
export function similarity(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

export function checkContent(inp: CheckInput): CheckResult {
  const issues: string[] = [];
  const full = `${inp.title}\n${inp.body}\n${inp.hashtags.join(" ")}`;
  const stripped = stripSafe(full);
  const f = fold(stripped);

  // 1) Quy tắc cứng
  const rawText = stripped;
  for (const r of HARD_RULES) {
    const m = (r.raw ? rawText : f).match(r.re);
    if (m) issues.push(`[${r.id}] ${r.why} — gặp: "${m[0].trim()}"`);
  }

  // 2) Cấu trúc & chính tả cơ bản
  if (!inp.title.trim()) issues.push("[format] Thiếu tiêu đề");
  if (inp.title.length > 80) issues.push(`[format] Tiêu đề quá dài (${inp.title.length}/80 ký tự)`);
  if (inp.titles && (inp.titles.length !== 3 || new Set(inp.titles.map(fold)).size !== 3)) issues.push("[format] Cần đúng 3 tiêu đề khác nhau");
  if (inp.body.length < 250) issues.push(`[format] Thân bài quá ngắn (${inp.body.length}/250)`);
  if (inp.body.length > 1400) issues.push(`[format] Thân bài quá dài (${inp.body.length}/1400)`);
  if (inp.hashtags.length < 2 || inp.hashtags.length > 5) issues.push("[format] Cần 2–5 hashtag");
  if (inp.hashtags.some((h) => !/^#[\p{L}\p{N}_]+$/u.test(h))) issues.push("[format] Hashtag sai định dạng");
  if (/Ã.|Ä.|â€|�/.test(full)) issues.push("[spelling] Lỗi mã hoá ký tự (mojibake)");
  if (/ {2,}|,,|\.\.(?!\.)|\s[,.;:!?]/.test(inp.body)) issues.push("[spelling] Khoảng trắng/dấu câu bất thường");
  const letters = (inp.body.match(/\p{L}/gu) ?? []).length;
  const accented = (inp.body.match(/[^\u0000-\u007f]/g) ?? []).length;
  if (letters > 0 && accented / letters < 0.12) issues.push("[spelling] Văn bản thiếu dấu tiếng Việt");
  if ((inp.body.match(/!/g) ?? []).length > 3) issues.push("[tone] Quá nhiều dấu chấm than");
  if (emojiCount(inp.body) > 6) issues.push("[tone] Quá nhiều biểu tượng cảm xúc");
  if (/[A-ZÀ-Ỹ]{12,}/.test(inp.body)) issues.push("[tone] Viết hoa toàn bộ cụm dài");

  // 3) Sản phẩm / công dụng
  const allProductNames = PRODUCTS.flatMap((p) => [p.name, ...p.nameAliases]).map(fold);
  const mentionsAnyProduct = allProductNames.some((n) => f.includes(n)) || FOREIGN_PRODUCT_CUES.some((c) => new RegExp(`\\b${c}\\b`).test(f));
  const usedClaimIds: string[] = [];

  if (inp.kind === "education") {
    if (mentionsAnyProduct) issues.push("[scope] Bài giáo dục 06:00 không được nhắc tên sản phẩm");
    if (/\b(coenzyme|coenzym|glucosamin|sun ca map|q10)\b/.test(f)) issues.push("[scope] Bài giáo dục không được nhắc thành phần sản phẩm");
    if (/\b(mua ngay|dat hang|dat mua|lien he mua|inbox de mua)\b/.test(f)) issues.push("[scope] Bài giáo dục không kêu gọi mua hàng");
  } else {
    const p = inp.product;
    if (!p) issues.push("[scope] Bài sản phẩm thiếu sản phẩm");
    else {
      if (!f.includes(fold(p.name))) issues.push(`[product] Phải ghi đúng tên "${p.name}" ít nhất 1 lần`);
      for (const other of PRODUCTS) {
        if (other.id === p.id) continue;
        if ([other.name, ...other.nameAliases].some((n) => f.includes(fold(n)))) issues.push(`[product] Nhắc sản phẩm khác (${other.name}) trong bài của ${p.name}`);
      }
      for (const cue of FOREIGN_PRODUCT_CUES) if (new RegExp(`\\b${cue}\\b`).test(f)) issues.push(`[product] Nhắc sản phẩm/thành phần ngoài hồ sơ: ${cue}`);

      // Claim nào xuất hiện nguyên văn trong bài
      for (const c of inp.approved) {
        if (f.includes(fold(c.text).replace(/\.$/, ""))) {
          usedClaimIds.push(c.id);
          if (!inp.allowedClaimIds.includes(c.id)) issues.push(`[claim] Dùng claim ${c.id} ngoài chủ đề được phép`);
          if (c.productId !== p.id) issues.push(`[claim] Claim ${c.id} thuộc sản phẩm khác`);
        }
      }
      // Câu nói về sản phẩm có từ chỉ công dụng -> phải là câu chứa claim nguyên văn (kèm tối đa phần dẫn ngắn)
      const cues = [p.name, ...p.nameAliases, ...p.ingredientCues, "san pham"].map(fold);
      for (const s of sentences(inp.body)) {
        const fs = fold(s);
        const aboutProduct = cues.some((c) => fs.includes(c));
        const isClaimSentence = inp.approved.some((c) => fs.includes(fold(c.text).replace(/\.$/, "")));
        if (isClaimSentence) {
          const rest = inp.approved.reduce((acc, c) => acc.replace(fold(c.text).replace(/\.$/, ""), ""), fs);
          if (rest.length > 70 && EFFICACY_CUE.test(rest)) issues.push(`[claim] Câu chứa claim còn kèm thêm ý công dụng khác: "${s.slice(0, 90)}"`);
          continue;
        }
        if (!aboutProduct || !EFFICACY_CUE.test(fs)) continue;
        if (/(khong (phai|co tac dung|nham)|tham khao|hoi y kien|hoi bac si|hoi thay thuoc|hoi thay)/.test(fs)) continue; // câu khuyến cáo chuẩn
        issues.push(`[claim] Câu nêu công dụng sản phẩm không khớp claim đã duyệt: "${s.slice(0, 90)}"`);
      }
      if (inp.allowedClaimIds.length && !inp.allowedClaimIds.every((id) => usedClaimIds.includes(id))) {
        issues.push(`[claim] Chủ đề này phải trích nguyên văn claim: ${inp.allowedClaimIds.join(", ")}`);
      }
    }
  }

  // 4) Chống trùng lặp nội dung
  for (const prev of inp.recentCaptions) {
    if (similarity(inp.body, prev) > 0.5) { issues.push("[duplicate] Nội dung quá giống một bài gần đây"); break; }
  }

  return { pass: issues.length === 0, issues, usedClaimIds: [...new Set(usedClaimIds)] };
}

/** Phần cuối bài do HỆ THỐNG gắn (không để AI tự viết). */
export function buildFooter(kind: SlotKind, product: Product | undefined, brandFooter: string): string {
  if (kind === "education") return brandFooter;
  return [...(product?.mandatoryLines ?? []), product ? `Số xác nhận nội dung quảng cáo: ${product.xnqc}.` : ""].filter(Boolean).join("\n");
}
