/**
 * Kiểm thử logic cốt lõi bằng bản giả lập (không gọi Claude, không gọi Meta, không ghi đĩa).
 * Chạy: npm test
 */
process.env.MOCK_LLM = "1";
process.env.MOCK_META = "1";
process.env.SKIP_IMAGE_CHECK = "1";
process.env.PUBLIC_BASE_URL = "https://example.test";
process.env.META_PAGE_ID = "1315954481600103";
process.env.META_PAGE_ACCESS_TOKEN = "MOCK_TOKEN_KTD";
process.env.APPROVED_CLAIMS = "NANO-01,RICH-01,RICH-02,RICH-03";

import { useMemoryStore } from "../lib/store";
import { checkContent, fold, similarity } from "../lib/compliance";
import { approvedClaims, productById } from "../lib/catalog";
import { nextSlotInstant, slotInstant, ictParts } from "../lib/config";
import { cancelScheduled, composeAndCheck, getSettings, listPosts, pickProduct, prepareSlot, saveSettings, type LlmImpl } from "../lib/pipeline";
import type { Draft, DraftContext } from "../lib/llm";

let pass = 0, failN = 0;
const t = (name: string, ok: boolean, extra = "") => { (ok ? pass++ : failN++); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  → " + extra}`); };

const LONG = "Buổi sáng là lúc cơ thể cần được chăm nhẹ nhàng nhất. Hôm nay mình chia sẻ với anh chị một thói quen nhỏ: đi bộ chậm mười lăm phút, uống một cốc nước ấm, hít thở sâu và duỗi nhẹ cổ chân. Mỗi người một thể trạng khác nhau, nên anh chị hãy nghe cơ thể mình và làm từ từ, đều đặn mỗi ngày. Nếu có băn khoăn về sức khỏe, hãy trao đổi với bác sĩ của anh chị. Anh chị đã có thói quen nhỏ nào cho buổi sáng? Chia sẻ ở phần bình luận nhé.";
const edu = (body: string, extra: Partial<Parameters<typeof checkContent>[0]> = {}) =>
  checkContent({ kind: "education", title: "Đi bộ buổi sáng đúng cách", body, hashtags: ["#VietDucSongKhoe", "#SucKhoe"], approved: approvedClaims(), allowedClaimIds: [], recentCaptions: [], ...extra });

async function main() {
  useMemoryStore();

  // ── Múi giờ & lịch ──
  const base = new Date("2026-10-19T20:00:00Z"); // = 03:00 ngày 20/10 giờ VN
  const m = nextSlotInstant(base, "0600");
  t("06:00 VN = 23:00 UTC hôm trước", m.date === "2026-10-20" && m.at.toISOString() === "2026-10-19T23:00:00.000Z", m.at.toISOString());
  const e = nextSlotInstant(new Date("2026-10-20T08:00:00Z"), "1800"); // 15:00 VN
  t("18:00 VN = 11:00 UTC cùng ngày", e.date === "2026-10-20" && e.at.toISOString() === "2026-10-20T11:00:00.000Z", e.at.toISOString());
  t("Sau giờ đăng -> chuyển sang ngày mai (không đăng bù)", nextSlotInstant(new Date("2026-10-20T12:00:00Z"), "1800").date === "2026-10-21");
  t("ictParts đúng ngày VN", ictParts(new Date("2026-10-19T20:00:00Z")).date === "2026-10-20");
  t("slotInstant", slotInstant("2026-10-20", "1800").toISOString() === "2026-10-20T11:00:00.000Z");

  // ── Kiểm duyệt: phải CHẶN ──
  const blocked: [string, string][] = [
    ["Sản phẩm giúp chữa khỏi đau khớp nhanh chóng.", "chữa khỏi"],
    ["Cam kết hiệu quả cho mọi người dùng.", "cam kết"],
    ["Dùng đều để tái tạo sụn khớp gối.", "tái tạo sụn"],
    ["Có thể dùng thay thế thuốc huyết áp của bạn.", "thay thế thuốc"],
    ["Hãy ngưng thuốc và dùng sản phẩm này.", "ngưng thuốc"],
    ["Giúp phòng ngừa đột quỵ hiệu quả.", "đột quỵ"],
    ["Nghiên cứu lâm sàng cho thấy rất tốt.", "nghiên cứu"],
    ["Hiệu quả lên tới 95% sau một tháng.", "phần trăm"],
    ["Giá chỉ 350.000đ một hộp, giảm giá hôm nay.", "giá"],
    ["Khách hàng đã khỏi hẳn sau một tháng.", "lời khách"],
    ["Bác sĩ khuyên dùng sản phẩm này mỗi ngày.", "bác sĩ khuyên"],
    ["Điều trị thoái hóa khớp tại nhà.", "điều trị"],
    ["Nattokinase giúp tan huyết khối.", "huyết khối/nattokinase"],
  ];
  for (const [txt, why] of blocked) {
    const r = edu(`${LONG} ${txt}`);
    t(`Chặn: ${why}`, !r.pass, JSON.stringify(r.issues));
  }
  t("Bài giáo dục sạch -> ĐẠT", edu(LONG).pass, JSON.stringify(edu(LONG).issues));
  t("Câu 'đang điều trị' / 'không thay thế thuốc' được phép", edu(`${LONG} Người đang điều trị bệnh nên hỏi bác sĩ. Thông tin này không thay thế tư vấn y khoa.`).pass);
  t("Bài giáo dục nhắc sản phẩm -> chặn", !edu(`${LONG} Anh chị có thể tham khảo RICH COENZYME Q10.`).pass);
  t("Bài giáo dục kêu gọi mua -> chặn", !edu(`${LONG} Mua ngay hôm nay nhé.`).pass);
  t("Thiếu dấu tiếng Việt -> chặn", !edu("Buoi sang la luc co the can duoc cham soc nhe nhang nhat. ".repeat(6)).pass);
  t("Lỗi mã hoá -> chặn", !edu(`${LONG} Ã¡ lá»—i`).pass);
  t("Quá ngắn -> chặn", !edu("Ngắn quá.").pass);
  t("Hashtag sai -> chặn", !edu(LONG, { hashtags: ["abc", "#ok"] }).pass);

  // ── Kiểm duyệt: bài sản phẩm ──
  const rich = productById("rich")!;
  const claimsRich = approvedClaims().filter((c) => c.id === "RICH-02");
  const prodBody = (mid: string) => `Chiều nay mình giải đáp một câu hỏi nhiều anh chị gửi về. ${mid}\nVới ${rich.name}, anh chị nên đọc kỹ nhãn trên hộp, xem hạn dùng và mục lưu ý trước khi dùng. Người đang dùng thuốc hoặc đang điều trị nên trao đổi với thầy thuốc trước. Anh chị còn thắc mắc gì, để lại bình luận nhé, mình sẽ giải đáp từng câu một cách cẩn thận và rõ ràng nhất.`;
  const prod = (body: string, allowed: string[]) => checkContent({ kind: "product", title: "RICH: điều cần biết", body, hashtags: ["#VietDucSongKhoe", "#Rich"], product: rich, approved: approvedClaims(), allowedClaimIds: allowed, recentCaptions: [] });
  const okClaim = prod(prodBody("Hỗ trợ chống oxy hóa, hỗ trợ giảm mệt mỏi."), ["RICH-02"]);
  t("Claim nguyên văn đã duyệt -> ĐẠT", okClaim.pass && okClaim.usedClaimIds.includes("RICH-02"), JSON.stringify(okClaim.issues));
  t("Diễn đạt lại công dụng ngoài claim -> chặn", !prod(prodBody(`${rich.name} giúp tăng cường sức khỏe tim và cải thiện trí nhớ rõ rệt.`), []).pass);
  t("Claim ngoài chủ đề được phép -> chặn", !prod(prodBody("Hỗ trợ giảm nguy cơ xơ vữa động mạch, tốt cho tim mạch."), ["RICH-02"]).pass);
  t("Claim chưa duyệt không dùng được", !checkContent({ kind: "product", title: "t", body: prodBody("Hỗ trợ chống oxy hóa, hỗ trợ giảm mệt mỏi."), hashtags: ["#a1", "#b2"], product: rich, approved: [], allowedClaimIds: ["RICH-02"], recentCaptions: [] }).pass);
  t("Thiếu tên sản phẩm chuẩn -> chặn", !prod(prodBody("Hỗ trợ chống oxy hóa, hỗ trợ giảm mệt mỏi.").replaceAll(rich.name, "viên uống này"), ["RICH-02"]).pass);
  t("Nhắc sản phẩm khác -> chặn", !prod(prodBody("Hỗ trợ chống oxy hóa, hỗ trợ giảm mệt mỏi.") + " NANO Premium SHARK CARTILAGE cũng hay.", ["RICH-02"]).pass);
  t("Chủ đề không claim: câu 'hỏi thầy thuốc' được phép", prod(prodBody("Hãy xem hộp và tham khảo ý kiến chuyên gia y tế trước khi dùng."), []).pass);
  void claimsRich;

  // ── Chống trùng nội dung ──
  t("Phát hiện nội dung trùng", similarity(LONG, LONG) > 0.9 && !edu(LONG, { recentCaptions: [LONG] }).pass);
  t("fold bỏ dấu đúng", fold("Đặc Trị, Chữa Khỏi") === "dac tri, chua khoi");

  // ── Vòng tự sửa tối đa 3 lần ──
  const ctx: DraftContext = { kind: "education", topic: { id: "x", group: "g", label: "Chủ đề thử", angle: "a" }, claims: [], dateLabel: "20/10" };
  const bad: Draft = { audience: "a", titles: ["A tiêu đề một", "B tiêu đề hai", "C tiêu đề ba"], chosenIndex: 0, chosenReason: "", body: `${LONG} Cam kết khỏi bệnh.`, hashtags: ["#VietDucSongKhoe", "#SucKhoe"] };
  const good: Draft = { ...bad, body: LONG };
  let calls = 0;
  const failsThen = (n: number): LlmImpl => ({
    writeDraft: async () => { calls++; return bad; },
    reviseDraft: async () => { calls++; return calls > n ? good : bad; },
    reviewDraft: async () => ({ pass: true, issues: [] }),
  });
  calls = 0; let r = await composeAndCheck(ctx, [], [], failsThen(2));
  t("Sửa được ở lần 3 -> ĐẠT", r.ok && r.attempts === 3, `${r.ok} ${r.attempts}`);
  calls = 0; r = await composeAndCheck(ctx, [], [], failsThen(99));
  t("Sau 3 lần sửa vẫn lỗi -> BỎ (1 viết + 3 sửa = 4 lượt)", !r.ok && r.attempts === 4 && calls === 4, `${r.ok} ${r.attempts} ${calls}`);
  const aiRejects: LlmImpl = { writeDraft: async () => good, reviseDraft: async () => good, reviewDraft: async () => ({ pass: false, issues: ["sai chính tả"] }) };
  r = await composeAndCheck(ctx, [], [], aiRejects);
  t("AI kiểm duyệt từ chối -> không đăng", !r.ok);
  const aiCrash: LlmImpl = { writeDraft: async () => good, reviseDraft: async () => good, reviewDraft: async () => { throw new Error("API down"); } };
  r = await composeAndCheck(ctx, [], [], aiCrash);
  t("Lỗi bước kiểm duyệt AI -> KHÔNG đăng (fail-closed)", !r.ok);
  calls = 0; r = await composeAndCheck(ctx, [], [], failsThen(0));
  t("Footer giáo dục do hệ thống gắn", r.ok && r.fullCaption.includes("không thay thế tư vấn y khoa"));

  // ── prepareSlot ──
  const T = new Date("2026-10-20T08:00:00Z"); // 15:00 VN ngày 20/10 -> chuẩn bị bài 18:00
  let res = await prepareSlot({ slot: "1800", now: T });
  t("Tắt tự động -> không làm gì", res.status === "disabled");
  await saveSettings({ ...(await getSettings()), autoEnabled: true });
  res = await prepareSlot({ slot: "1800", now: T });
  t("Bật -> hẹn giờ thành công", res.status === "scheduled" && !!res.post?.fbPostId && res.post.publishAt === "2026-10-20T11:00:00.000Z", JSON.stringify(res).slice(0, 300));
  t("Bài 18:00 có đúng tên sản phẩm + cảnh báo bắt buộc", !!res.post && res.post.caption.includes("không phải là thuốc") && /NANO Premium SHARK CARTILAGE|RICH COENZYME Q10/.test(res.post.caption), res.post?.caption.slice(-300));
  t("Bài 18:00 có số xác nhận quảng cáo", !!res.post && /XNQC-ATTP/.test(res.post.caption));
  t("Có 3 tiêu đề + 1 tiêu đề chọn", res.post?.titles.length === 3 && !!res.post.title);
  const dup = await prepareSlot({ slot: "1800", now: new Date(T.getTime() + 60000) });
  t("Chạy lại cùng khung giờ -> chống trùng", dup.status === "duplicate");
  const late = await prepareSlot({ slot: "0600", now: new Date("2026-10-19T22:50:00Z") }); // 05:50 VN: còn 10 phút
  t("Quá sát giờ -> bỏ lượt, không đăng bù", late.status === "skipped");
  const next = await prepareSlot({ slot: "0600", now: new Date("2026-10-19T20:00:00Z") });
  t("Bài 06:00 là giáo dục, không nhắc sản phẩm", next.status === "scheduled" && next.post?.kind === "education" && !/NANO|RICH/i.test(next.post.caption), JSON.stringify([next.status, next.reason, next.post?.complianceLog]));
  const dayAfter = await prepareSlot({ slot: "1800", now: new Date("2026-10-21T08:00:00Z") });
  t("Hôm sau luân phiên sản phẩm khác", dayAfter.status === "scheduled" && dayAfter.post?.productId !== res.post?.productId, JSON.stringify([dayAfter.status, dayAfter.reason, dayAfter.post?.complianceLog]));
  t("pickProduct xen kẽ", pickProduct("2026-10-20").id !== pickProduct("2026-10-21").id);
  t("Không trùng chủ đề liên tiếp", dayAfter.post?.topicId !== res.post?.topicId);

  // ── Tắt tự động -> huỷ bài đã hẹn (dùng bài hẹn trong TƯƠNG LAI, không phụ thuộc ngày chạy test) ──
  {
    const { savePost: sp } = await import("../lib/pipeline");
    const future = new Date(Date.now() + 3 * 86400000).toISOString();
    await sp({ id: "cancel-me", slot: "1800", channel: "ktd", kind: "product", date: "2099-01-01", publishAt: future, status: "scheduled", dryRun: false, topicId: "x", topicLabel: "x", titles: [], title: "x", caption: "x", hashtags: [], claimIds: [], imageKind: "product", attempts: 1, complianceLog: [], fbPostId: "MOCK_cancel", createdAt: "", updatedAt: "" });
    const n = await cancelScheduled();
    const left = (await listPosts(80)).filter((p) => p.status === "scheduled" && new Date(p.publishAt).getTime() > Date.now()).length;
    t("Tắt -> huỷ các bài còn hẹn trong tương lai", n >= 1 && left === 0, `${n} ${left}`);
  }

  // ── Claim chưa duyệt -> chủ đề cần claim bị loại khỏi kho ──
  process.env.APPROVED_CLAIMS = "";
  const { pickTopic } = await import("../lib/pipeline");
  let allNoClaim = true;
  for (const d of ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]) {
    const p = await pickTopic("product", d);
    if (!p || p.claimIds.length) allNoClaim = false;
  }
  t("Chưa duyệt claim -> chỉ chọn chủ đề không nêu công dụng", allNoClaim);

  // ── Page thứ hai: Sống Khỏe 07:00 / 19:00 ──
  {
    process.env.APPROVED_CLAIMS = "NANO-01,RICH-01,RICH-02,RICH-03";
    useMemoryStore(); // bộ nhớ sạch: tránh "bài gần đây" giả lập của các test trước làm bộ chống trùng chặn
    await saveSettings({ ...(await getSettings()), autoEnabled: true });
    const T2 = new Date("2026-11-10T07:00:00Z"); // 14:00 VN 10/11
    let r2 = await prepareSlot({ slot: "1900", now: T2 });
    t("Sống Khỏe chưa cấu hình -> tự bỏ qua, không lỗi", r2.status === "disabled", JSON.stringify(r2).slice(0, 200));
    process.env.META_PAGE_ID_SK = "999999999";
    process.env.META_PAGE_ACCESS_TOKEN_SK = "MOCK_TOKEN_SK";
    process.env.META_PAGE_ACCESS_TOKEN = "MOCK_TOKEN_KTD";
    const a = await prepareSlot({ slot: "1800", now: T2 });
    r2 = await prepareSlot({ slot: "1900", now: T2 });
    t("Sống Khỏe 19:00 hẹn thành công, đúng kênh", r2.status === "scheduled" && r2.post?.channel === "sk" && r2.post.publishAt === "2026-11-10T12:00:00.000Z", JSON.stringify([r2.status, r2.reason]).slice(0, 600));
    t("Cùng ngày: 2 Page nói về 2 sản phẩm khác nhau", a.status === "scheduled" && a.post?.productId !== r2.post?.productId, `${a.status} ${a.post?.productId} ${r2.post?.productId}`);
    t("Cùng ngày: 2 Page khác chủ đề", a.post?.topicId !== r2.post?.topicId);
    const e1 = await prepareSlot({ slot: "0600", now: new Date("2026-11-10T20:00:00Z") });
    const e2 = await prepareSlot({ slot: "0700", now: new Date("2026-11-10T21:00:00Z") });
    t("Giáo dục 06:00 và 07:00 khác chủ đề", e1.status === "scheduled" && e2.status === "scheduled" && e1.post?.topicId !== e2.post?.topicId && e2.post?.channel === "sk", `${e1.status} ${e2.status} ${e1.post?.topicId} ${e2.post?.topicId}`);
    t("Bài 07:00 giờ VN = 00:00 UTC", e2.post?.publishAt === "2026-11-11T00:00:00.000Z", e2.post?.publishAt);
  }

  // ── Sản phẩm DHA.EPA+SQ: chỉ vào luân phiên khi chủ page DUYỆT claim DHA-01 ──
  {
    const { pickProduct } = await import("../lib/pipeline");
    process.env.APPROVED_CLAIMS = "NANO-01,RICH-01,RICH-02,RICH-03";
    const ids1 = new Set<string>();
    for (let d = 1; d <= 12; d++) ids1.add(pickProduct(`2026-12-${String(d).padStart(2, "0")}`).id);
    t("Chưa duyệt DHA-01 -> DHA KHÔNG được chọn", !ids1.has("dha") && ids1.size === 2, [...ids1].join(","));
    process.env.APPROVED_CLAIMS = "NANO-01,RICH-01,RICH-02,RICH-03,DHA-01";
    const ids2 = new Set<string>();
    for (let d = 1; d <= 12; d++) ids2.add(pickProduct(`2026-12-${String(d).padStart(2, "0")}`).id);
    t("Đã duyệt DHA-01 -> 3 sản phẩm luân phiên", ids2.size === 3 && ids2.has("dha"), [...ids2].join(","));

    useMemoryStore();
    await saveSettings({ ...(await getSettings()), autoEnabled: true });
    let found: Awaited<ReturnType<typeof prepareSlot>> | null = null;
    for (let d = 1; d <= 9 && !found; d++) {
      const day = `2026-12-${String(d).padStart(2, "0")}`;
      if (pickProduct(day, 0).id !== "dha") continue;
      found = await prepareSlot({ slot: "1800", now: new Date(`${day}T06:00:00Z`) });
    }
    t("Bài DHA có tên đúng + số XNQC 892/2022 + cảnh báo", !!found && found.status === "scheduled" && !!found.post && found.post.caption.includes("DHA.EPA+SQ") && found.post.caption.includes("892/2022/XNQC-ATTP") && found.post.caption.includes("Trong thời kỳ đang sử dụng các loại thuốc khác"), JSON.stringify([found?.status, found?.reason]).slice(0, 300));
    if (found?.post && found.post.claimIds.length) t("Bài DHA nêu công dụng chỉ bằng claim nguyên văn DHA-01", found.post.claimIds.join() === "DHA-01" && found.post.caption.includes("Hỗ trợ giúp cải thiện triệu chứng khô mắt, hỗ trợ giảm nguy cơ thoái hóa điểm vàng."));

    const edu = checkContent({ kind: "education", title: "Mắt khỏe", body: LONG + " Nhiều người bổ sung DHA mỗi ngày.", hashtags: ["#VietDucSongKhoe", "#SucKhoe"], approved: approvedClaims(), allowedClaimIds: [], recentCaptions: [] });
    t("Bài giáo dục nhắc thành phần DHA -> chặn", !edu.pass);
    const rich = productById("rich")!;
    const cross = checkContent({ kind: "product", title: "RICH", body: `Chiều nay mình giải đáp. Với ${rich.name}, anh chị đọc kỹ nhãn trước khi dùng. Có người còn dùng thêm DHA và EPA, nhưng đó là chuyện khác. Người đang dùng thuốc hỏi chuyên gia y tế trước khi dùng. Anh chị còn thắc mắc gì, để lại bình luận nhé, mình sẽ giải đáp từng câu một cách cẩn thận và rõ ràng.`, hashtags: ["#VietDucSongKhoe", "#Rich"], product: rich, approved: approvedClaims(), allowedClaimIds: [], recentCaptions: [] });
    t("Bài RICH nhắc thành phần sản phẩm khác (DHA/EPA) -> chặn", !cross.pass);
    process.env.APPROVED_CLAIMS = "NANO-01,RICH-01,RICH-02,RICH-03";
  }

  // ── Video Page Sống Khỏe: 06:15 / 11:30 / 19:30, theo thứ tự tải lên ──
  {
    const { setVideoQueueForTest, loadQueue } = await import("../lib/videos");
    useMemoryStore();
    await saveSettings({ ...(await getSettings()), autoEnabled: true });
    const cap = "Sau tuổi 40, nhiều anh chị nghĩ khớp đau là do thiếu canxi nên mua canxi về uống. Nhưng canxi chủ yếu giúp xương chắc khỏe, còn khớp gối là cả một hệ thống gồm sụn, dịch khớp, dây chằng, gân và cơ. Việt Đức chia sẻ vài điều nên quan tâm để chăm khớp lâu dài: giữ cân nặng hợp lý, vận động vừa sức, ăn uống đủ chất và đi khám khi đau kéo dài. Anh chị có hay thấy cứng gối buổi sáng không? Bình luận để mình cùng trao đổi nhé.";
    const mkv = (n: number, created: string, caption = cap) => ({ id: `v${n}`, driveFileId: `FILE${n}`, fileName: `viet-duc-suc-khoe-0${n}.mp4`, createdTime: created, title: `Tiêu đề video ${n}`, caption, hashtags: ["#VietDucSongKhoe", "#SucKhoe"] });
    // đưa vào NGƯỢC thứ tự để chứng minh hệ thống sắp theo thời điểm tải lên
    setVideoQueueForTest([mkv(2, "2026-10-26T17:17:00Z"), mkv(1, "2026-10-26T15:13:00Z")]);
    t("Hàng chờ sắp theo thời điểm tải lên", loadQueue()[0].id === "v1");

    const D = new Date("2026-11-20T10:00:00Z"); // 17:00 VN
    const a = await prepareSlot({ slot: "1930", now: D });
    t("Video 19:30 hẹn thành công, Page Sống Khỏe", a.status === "scheduled" && a.post?.kind === "video" && a.post.channel === "sk" && a.post.videoId === "v1", JSON.stringify([a.status, a.reason]));
    t("Giờ 19:30 VN = 12:30 UTC", a.post?.publishAt === "2026-11-20T12:30:00.000Z", a.post?.publishAt);
    t("Caption video có cảnh báo + hashtag do hệ thống gắn", !!a.post && a.post.caption.includes("không thay thế tư vấn y khoa") && a.post.caption.includes("#VietDucSongKhoe"));
    const dup = await prepareSlot({ slot: "1930", now: new Date(D.getTime() + 60000) });
    t("Video: chạy lại cùng khung -> chống trùng", dup.status === "duplicate");
    const b = await prepareSlot({ slot: "0615", now: new Date("2026-11-20T20:00:00Z") }); // 03:00 VN 21/11
    t("Khung kế tiếp lấy video thứ hai (đúng thứ tự)", b.status === "scheduled" && b.post?.videoId === "v2" && b.post.publishAt === "2026-11-20T23:15:00.000Z", JSON.stringify([b.status, b.reason, b.post?.publishAt]));
    const c = await prepareSlot({ slot: "1130", now: new Date("2026-11-21T01:00:00Z") });
    t("Hàng chờ hết -> bỏ qua, không lỗi, không đăng bù", c.status === "skipped" && /trống/.test(c.reason ?? ""), JSON.stringify([c.status, c.reason]));
    t("Hàng chờ trống không khoá khung giờ (video mới vào sẽ được nhận)", !(await (await import("../lib/store")).getStore().get("slot:2026-11-21:1130")));

    // caption vi phạm -> video bị chặn, không đăng; video hợp lệ kế tiếp được dùng
    useMemoryStore();
    await saveSettings({ ...(await getSettings()), autoEnabled: true });
    setVideoQueueForTest([mkv(1, "2026-10-26T15:13:00Z", cap + " Sản phẩm này chữa khỏi đau khớp, cam kết hiệu quả."), mkv(2, "2026-10-26T17:17:00Z")]);
    const d = await prepareSlot({ slot: "1930", now: D });
    t("Caption vi phạm bị chặn; video hợp lệ kế tiếp được đăng", d.status === "scheduled" && d.post?.videoId === "v2", JSON.stringify([d.status, d.reason]));
    const { getVideoState } = await import("../lib/videos");
    t("Video vi phạm được đánh dấu 'blocked'", (await getVideoState("v1"))?.status === "blocked");
    setVideoQueueForTest(null);
  }

  // ── Watchdog: đối soát + tự sửa báo nhầm "thất bại" ──
  {
    const { savePost: sp, getPost: gp, watchdog: wd } = await import("../lib/pipeline");
    const mk = (id: string, status: "scheduled" | "failed") => ({
      id, slot: "0600" as const, kind: "education" as const, date: "2026-10-21", publishAt: "2026-10-20T23:00:00.000Z", status, dryRun: false,
      topicId: "x", topicLabel: "x", titles: ["a", "b", "c"], title: "Giữ cân nặng hợp lý", caption: "c", hashtags: [], claimIds: [],
      imageKind: "education" as const, attempts: 1, complianceLog: [], fbPostId: "122127106575466365", error: status === "failed" ? "Bài hẹn giờ không còn trên Facebook" : undefined,
      createdAt: "", updatedAt: "",
    });
    await sp(mk("wd-sched", "scheduled"));
    await sp(mk("wd-failed", "failed"));
    await wd(new Date("2026-10-21T00:00:00Z")); // 07:00 VN
    t("Watchdog: bài quá giờ -> posted", (await gp("wd-sched"))?.status === "posted");
    t("Watchdog: bài 'thất bại' nhầm trong 24h -> tự sửa thành posted", (await gp("wd-failed"))?.status === "posted" && !(await gp("wd-failed"))?.error);
  }

  console.log(`\n${pass} PASS / ${failN} FAIL`);
  process.exit(failN ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
