import { env } from "./config";

/**
 * Hồ sơ sản phẩm + chủ đề. Nguồn: personal-brand-ai/knowledge (claim-registry.md, products/*).
 * Quy tắc: AI KHÔNG được tự thêm công dụng. Chỉ các claim dưới đây, và chỉ khi chủ page đã
 * duyệt (biến môi trường APPROVED_CLAIMS), mới được dùng – nguyên văn.
 */
export interface Claim { id: string; productId: string; text: string; source: string }

export interface Product {
  id: string;
  name: string; // tên chuẩn, phải viết đúng như vậy
  nameAliases: string[]; // cách gọi khác được chấp nhận khi kiểm tra
  ingredientCues: string[]; // từ khoá thành phần – câu nhắc tới các từ này coi như đang nói về sản phẩm
  image: string; // ảnh thật, trong /assets/products, KHÔNG chỉnh sửa
  ownerPhoto?: string; // ảnh thật Việt Đức cầm sản phẩm (assets/portraits), do chủ page gửi & xác nhận
  xnqc: string; // số Giấy xác nhận nội dung quảng cáo
  mandatoryLines: string[]; // câu cảnh báo bắt buộc, do CODE gắn vào cuối bài
  audienceHint: string;
}

export const PRODUCTS: Product[] = [
  {
    id: "nano",
    name: "NANO Premium SHARK CARTILAGE",
    nameAliases: ["nano premium shark cartilage", "nano shark cartilage", "nano sun ca map"],
    ingredientCues: ["glucosamin", "sụn cá mập", "chiết xuất sụn"],
    image: "sun.png",
    ownerPhoto: "viet-duc-nano.jpg", // chủ page gửi "Đây hình thật tôi" (20/10/2026)
    xnqc: "2016/2022/XNQC-ATTP",
    mandatoryLines: [
      "Thực phẩm này không phải là thuốc, không có tác dụng thay thế thuốc chữa bệnh.",
      "Hạn chế sử dụng đối với những người bị dị ứng, người đang mang thai hoặc người đang điều trị bệnh.",
      "Nếu bạn không cảm thấy khỏe sau khi sử dụng, vui lòng ngừng sử dụng.",
    ],
    audienceHint: "Người trung niên – cao tuổi hay vận động nhưng lo cho khớp gối, cần thông tin rõ ràng, không bị hứa hẹn quá đà.",
  },
  {
    id: "rich",
    name: "RICH COENZYME Q10",
    nameAliases: ["rich coenzyme q10", "rich coq10", "rich q10"],
    ingredientCues: ["coenzyme q10", "coenzym q10", "coq10"],
    image: "rich.png",
    xnqc: "1582/2024/XNQC-ATTP",
    mandatoryLines: [
      "Thực phẩm này không phải là thuốc và không có tác dụng thay thế thuốc chữa bệnh.",
      "Người đang dùng thuốc, đang mắc bệnh tham khảo ý kiến chuyên gia y tế trước khi dùng.",
      "Sản phẩm này không nhằm mục đích chẩn đoán, điều trị hoặc phòng ngừa bệnh tật.",
    ],
    audienceHint: "Người trung niên hay mệt mỏi, quan tâm tim mạch, thường đã uống thuốc kê đơn nên rất cần lời nhắc hỏi thầy thuốc.",
  },
];

export const CLAIMS: Claim[] = [
  { id: "NANO-01", productId: "nano", text: "Bổ sung glucosamin và bột chiết xuất sụn cá mập hỗ trợ tốt cho khớp.", source: "XNQC 2016/2022/XNQC-ATTP" },
  { id: "RICH-01", productId: "rich", text: "Hỗ trợ bổ sung Coenzyme Q10 cho cơ thể.", source: "XNQC 1582/2024/XNQC-ATTP" },
  { id: "RICH-02", productId: "rich", text: "Hỗ trợ chống oxy hóa, hỗ trợ giảm mệt mỏi.", source: "XNQC 1582/2024/XNQC-ATTP" },
  { id: "RICH-03", productId: "rich", text: "Hỗ trợ giảm nguy cơ xơ vữa động mạch, tốt cho tim mạch.", source: "XNQC 1582/2024/XNQC-ATTP" },
];

/** Claim đã được CHỦ PAGE duyệt: APPROVED_CLAIMS=NANO-01,RICH-01,... (đổi cần deploy lại – cố ý). */
export function approvedClaims(): Claim[] {
  const ids = env("APPROVED_CLAIMS").split(",").map((s) => s.trim()).filter(Boolean);
  return CLAIMS.filter((c) => ids.includes(c.id));
}

/**
 * Ảnh chân dung: assets/portraits/viet-duc-confirmed.jpg do chính Việt Đức gửi và xác nhận "Ảnh mặt tôi đây" (20/10/2026).
 * Mặc định BẬT; đặt PORTRAIT_CONFIRMED=0 để tắt ảnh người.
 */
export const portraitConfirmed = () => env("PORTRAIT_CONFIRMED") !== "0";

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);

/** Tên các sản phẩm/thành phần ngoài hệ thống – không được xuất hiện (chưa có hồ sơ công bố). */
export const FOREIGN_PRODUCT_CUES = ["nattokinase", "ellagic", "dha", "epa", "insuna", "fujina", "raydel", "policosanol"];

export interface Topic {
  id: string;
  group: string; // nhóm để tránh đăng 2 chủ đề cùng nhóm liên tiếp
  label: string;
  angle: string; // gợi ý góc tiếp cận cho người viết
}

export interface ProductTopic extends Topic {
  productId: string;
  claimIds: string[]; // rỗng = không cần nêu công dụng
}

/** 06:00 – Giáo dục sức khỏe: KHÔNG nhắc sản phẩm, KHÔNG nêu số liệu/nghiên cứu. */
export const EDU_TOPICS: Topic[] = [
  { id: "edu-khop-01", group: "khop", label: "Đi bộ buổi sáng đúng cách cho đầu gối", angle: "Khởi động 5 phút, giày phù hợp, tăng dần quãng đường, dừng khi đau nhói." },
  { id: "edu-khop-02", group: "khop", label: "Cân nặng và áp lực lên khớp gối", angle: "Mỗi bước chân dồn tải lên gối; giữ cân nặng hợp lý là cách nhẹ gánh cho khớp." },
  { id: "edu-khop-03", group: "khop", label: "Leo cầu thang: mẹo bảo vệ khớp gối", angle: "Tư thế, bám tay vịn, nghỉ giữa chừng; không cố gắng quá sức." },
  { id: "edu-khop-04", group: "khop", label: "Ngồi lâu có hại cho khớp không?", angle: "Đứng dậy vận động nhẹ mỗi 45–60 phút; xoay cổ chân, duỗi gối." },
  { id: "edu-khop-05", group: "khop", label: "Trời trở lạnh, khớp nhức mỏi: giữ ấm thế nào?", angle: "Giữ ấm đầu gối, tắm nước ấm, vận động nhẹ; đau kéo dài thì đi khám." },
  { id: "edu-tim-01", group: "tim", label: "Vì sao người lớn tuổi nên đo huyết áp đều đặn?", angle: "Đo cùng giờ, ngồi nghỉ 5 phút trước khi đo, ghi sổ để đưa bác sĩ xem." },
  { id: "edu-tim-02", group: "tim", label: "Bữa sáng nhẹ cho người trung niên", angle: "Đa dạng rau, đạm vừa đủ, ít muối, ít chiên rán; uống đủ nước." },
  { id: "edu-tim-03", group: "tim", label: "Ăn mặn: thói quen nhỏ, hệ quả lâu dài", angle: "Nếm trước khi nêm, giảm nước chấm, ưu tiên gia vị tự nhiên." },
  { id: "edu-tim-04", group: "tim", label: "Hít thở sâu 3 phút giúp tinh thần nhẹ nhõm", angle: "Hướng dẫn hít 4 giây – thở 6 giây; làm khi căng thẳng; không thay điều trị." },
  { id: "edu-nangluong-01", group: "nangluong", label: "Sáng dậy vẫn thấy mệt: 5 thói quen cần xem lại", angle: "Giờ ngủ, ánh sáng buổi sáng, nước, bữa tối nặng, ít vận động; kéo dài thì đi khám." },
  { id: "edu-nangluong-02", group: "nangluong", label: "Uống đủ nước trong ngày: cách nhớ đơn giản", angle: "Một cốc sau khi thức dậy, bình nước đặt gần tầm mắt, nhắc theo bữa ăn." },
  { id: "edu-nangluong-03", group: "nangluong", label: "Nắng sáng 10–15 phút: thói quen nhỏ cho ngày mới", angle: "Tránh nắng gắt, mũ nón, kết hợp đi bộ nhẹ; không thay lời khuyên bác sĩ." },
  { id: "edu-ngu-01", group: "ngu", label: "Ngủ trước 23 giờ: vì sao quan trọng với người lớn tuổi?", angle: "Giờ ngủ đều, phòng tối mát, tránh điện thoại; ngủ kém kéo dài thì đi khám." },
  { id: "edu-ngu-02", group: "ngu", label: "Bữa tối nhẹ giúp đêm ngủ dễ hơn", angle: "Ăn tối sớm, hạn chế đồ chiên rán, trà đặc, rượu bia." },
  { id: "edu-ngu-03", group: "ngu", label: "Ngủ trưa bao lâu là vừa?", angle: "15–30 phút, tránh ngủ quá muộn trong ngày." },
  { id: "edu-dinhduong-01", group: "dinhduong", label: "Đĩa ăn cân đối cho người trung niên", angle: "Nửa đĩa rau, một phần đạm, một phần tinh bột; ăn chậm, nhai kỹ." },
  { id: "edu-dinhduong-02", group: "dinhduong", label: "Rau xanh mỗi ngày: bắt đầu từ đâu?", angle: "Thêm một món rau mỗi bữa, đa dạng màu sắc, nấu vừa chín." },
  { id: "edu-dinhduong-03", group: "dinhduong", label: "Cá và đạm thực vật trong bữa cơm gia đình", angle: "Hấp, luộc, kho nhạt thay vì chiên; chia nhỏ khẩu phần." },
  { id: "edu-vandong-01", group: "vandong", label: "5 động tác duỗi nhẹ trước khi ra khỏi giường", angle: "Xoay cổ chân, co duỗi gối, nghiêng thân, xoay vai, hít sâu; làm chậm, không gồng." },
  { id: "edu-vandong-02", group: "vandong", label: "Tập dưỡng sinh buổi sáng: bắt đầu thế nào?", angle: "Chọn nơi thoáng, mặc thoải mái, 15 phút đầu, tăng dần; đau thì dừng." },
  { id: "edu-vandong-03", group: "vandong", label: "Vì sao không nên tập quá sức khi tuổi đã cao?", angle: "Lắng nghe cơ thể, khởi động kỹ, nghỉ đủ, khám sức khoẻ định kỳ." },
  { id: "edu-thuoc-01", group: "an-toan", label: "Đang uống thuốc kê đơn: điều cần hỏi bác sĩ trước khi dùng thêm bất cứ gì", angle: "Mang theo danh sách thuốc, hỏi về tương tác; không tự ngưng thuốc." },
  { id: "edu-thuoc-02", group: "an-toan", label: "Khám sức khoẻ định kỳ: lịch gợi ý cho người trên 40", angle: "Hỏi bác sĩ lịch khám phù hợp; lưu kết quả; mang theo khi đi khám." },
  { id: "edu-docnhan-01", group: "docnhan", label: "Đọc nhãn thực phẩm: 3 mục nên nhìn trước tiên", angle: "Thành phần, hạn dùng, cảnh báo/đối tượng không nên dùng; không nhắc nhãn hiệu cụ thể." },
  { id: "edu-docnhan-02", group: "docnhan", label: "Thực phẩm bảo vệ sức khỏe khác thuốc ở điểm nào?", angle: "Không phải thuốc, không thay thế thuốc; hỏi thầy thuốc khi đang điều trị; không nhắc nhãn hiệu cụ thể." },
  { id: "edu-khop-06", group: "khop", label: "Làm việc nhà mà không mỏi gối", angle: "Ngồi ghế thấp thay vì ngồi xổm lâu, đổi tư thế thường xuyên, nghỉ giữa chừng." },
  { id: "edu-khop-07", group: "khop", label: "Xách đồ đi chợ: cách mang cho nhẹ người", angle: "Chia đều hai tay, dùng xe kéo, không xách quá nặng một lần." },
  { id: "edu-khop-08", group: "khop", label: "Chọn giày cho người hay đi bộ", angle: "Đế êm, vừa chân, mũi giày rộng, thay giày khi đế mòn." },
  { id: "edu-khop-09", group: "khop", label: "Phòng té ngã trong nhà cho người lớn tuổi", angle: "Đèn ngủ, thảm chống trượt, tay vịn nhà tắm, dọn dây điện trên lối đi." },
  { id: "edu-tim-05", group: "tim", label: "Đo huyết áp tại nhà: những lỗi hay gặp", angle: "Đo sau khi vừa vận động, nói chuyện khi đo, vòng bít sai cỡ; nên ghi lại để đưa bác sĩ." },
  { id: "edu-tim-06", group: "tim", label: "Bớt đường trong ly nước mỗi ngày", angle: "Giảm dần đường, ưu tiên nước lọc, trà nhạt; đọc nhãn đồ uống đóng chai." },
  { id: "edu-tim-07", group: "tim", label: "Trời nắng nóng: giữ sức cho người trung niên", angle: "Uống nước rải rác, tránh ra nắng gắt giữa trưa, mặc đồ thoáng; mệt bất thường thì đi khám." },
  { id: "edu-nangluong-04", group: "nangluong", label: "Giữa buổi chiều hay buồn ngủ: thử 3 việc nhỏ", angle: "Đứng dậy đi lại, uống nước, ra ngoài hít thở; xem lại giấc ngủ đêm." },
  { id: "edu-nangluong-05", group: "nangluong", label: "Căng thẳng công việc: cách xả nhẹ trong 5 phút", angle: "Hít thở chậm, đi bộ ngắn, nói chuyện với người thân; kéo dài thì tìm hỗ trợ." },
  { id: "edu-ngu-04", group: "ngu", label: "Điện thoại trước giờ ngủ: nên cất lúc nào?", angle: "Cất trước giờ ngủ khoảng 30–60 phút, đọc sách giấy, giảm ánh sáng phòng." },
  { id: "edu-ngu-05", group: "ngu", label: "Thức giấc lúc nửa đêm: làm gì để ngủ lại?", angle: "Không xem điện thoại, hít thở chậm, giữ phòng tối; mất ngủ kéo dài thì hỏi bác sĩ." },
  { id: "edu-dinhduong-04", group: "dinhduong", label: "Ăn trái cây thế nào cho hợp lý?", angle: "Ăn đa dạng, ưu tiên trái cây tươi thay nước ép đóng chai, chia nhỏ trong ngày." },
  { id: "edu-dinhduong-05", group: "dinhduong", label: "Bữa sáng vội: vài lựa chọn đơn giản", angle: "Chuẩn bị từ tối, kết hợp tinh bột – đạm – rau; tránh bỏ bữa sáng thường xuyên." },
  { id: "edu-dinhduong-06", group: "dinhduong", label: "Uống rượu bia: biết điểm dừng", angle: "Hạn chế, không ép nhau, không lái xe; người đang dùng thuốc hỏi bác sĩ." },
  { id: "edu-vandong-04", group: "vandong", label: "Vận động nhẹ cho người làm văn phòng", angle: "Đứng dậy mỗi giờ, xoay vai cổ, đi cầu thang ngắn; không gồng quá sức." },
  { id: "edu-vandong-05", group: "vandong", label: "Đi bộ cùng gia đình buổi tối", angle: "Đi sau bữa tối một lúc, chọn đường sáng và bằng phẳng, đi chậm vừa sức." },
  { id: "edu-vandong-06", group: "vandong", label: "Làm vườn cũng là vận động", angle: "Khởi động trước, đổi tư thế, nâng vật nặng bằng chân không bằng lưng, đội mũ." },
  { id: "edu-an-toan-03", group: "an-toan", label: "Tủ thuốc gia đình: sắp xếp sao cho an toàn", angle: "Để xa tầm tay trẻ em, kiểm tra hạn dùng, giữ nguyên hộp và tờ hướng dẫn." },
  { id: "edu-an-toan-04", group: "an-toan", label: "Đi khám bệnh: chuẩn bị gì để hỏi bác sĩ cho đủ?", angle: "Ghi triệu chứng, danh sách thuốc, câu hỏi cần hỏi; mang kết quả khám cũ." },
  { id: "edu-docnhan-03", group: "docnhan", label: "Mua hàng online: cách tránh hàng không rõ nguồn gốc", angle: "Mua ở nơi uy tín, xem thông tin nhà sản xuất trên hộp, hỏi rõ trước khi mua; không nhắc nhãn hiệu cụ thể." },
];

/** 18:00 – Kiến thức sản phẩm / giải đáp. `claimIds` rỗng = chủ đề không cần nêu công dụng. */
export const PRODUCT_TOPICS: ProductTopic[] = [
  { id: "nano-q-claim", productId: "nano", group: "nano-claim", label: "Hồ sơ NANO nói gì về khớp?", angle: "Trích đúng câu công dụng đã được xác nhận, giải thích 'hỗ trợ' nghĩa là gì, nhắc vận động và hỏi thầy thuốc.", claimIds: ["NANO-01"] },
  { id: "nano-q-label", productId: "nano", group: "nano-label", label: "Đọc hộp NANO: ba mục cần xem", angle: "Hướng dẫn tìm tên sản phẩm, hạn dùng và lưu ý đối tượng trên hộp thật; không nêu công dụng ngoài hồ sơ.", claimIds: [] },
  { id: "nano-q-who", productId: "nano", group: "nano-who", label: "Ai nên hỏi thầy thuốc trước khi dùng NANO?", angle: "Người dị ứng, mang thai, đang điều trị bệnh; nhắc đúng các câu lưu ý bắt buộc.", claimIds: [] },
  { id: "nano-q-notmed", productId: "nano", group: "nano-notmed", label: "Giải đáp: NANO có thay thế thuốc không?", angle: "Trả lời rõ: không; thực phẩm bảo vệ sức khỏe khác thuốc; không tự ngưng thuốc.", claimIds: [] },
  { id: "nano-q-life", productId: "nano", group: "nano-life", label: "Chăm khớp không chỉ là một sản phẩm", angle: "Vận động, cân nặng, giày dép, nghỉ ngơi; NANO chỉ là một phần, kèm lời nhắc hỏi thầy thuốc.", claimIds: [] },
  { id: "rich-q-claim1", productId: "rich", group: "rich-claim1", label: "RICH COENZYME Q10: hồ sơ ghi công dụng gì?", angle: "Trích đúng câu công dụng đã được xác nhận 'hỗ trợ bổ sung Coenzyme Q10', không suy diễn thêm.", claimIds: ["RICH-01"] },
  { id: "rich-q-tired", productId: "rich", group: "rich-tired", label: "Hay mệt mỏi? Xem lại lối sống trước, sản phẩm là phần hỗ trợ", angle: "Giấc ngủ, ăn uống, vận động; trích đúng 'hỗ trợ chống oxy hóa, hỗ trợ giảm mệt mỏi'; mệt kéo dài thì đi khám.", claimIds: ["RICH-02"] },
  { id: "rich-q-heart", productId: "rich", group: "rich-heart", label: "Tim mạch: điều bình thường nhất là thói quen mỗi ngày", angle: "Ăn ít muối, vận động, đo huyết áp; trích đúng câu công dụng, KHÔNG hứa phòng/chữa bệnh tim mạch.", claimIds: ["RICH-03"] },
  { id: "rich-q-meds", productId: "rich", group: "rich-meds", label: "Giải đáp: đang uống thuốc có dùng RICH được không?", angle: "Không tự quyết định; tham khảo ý kiến chuyên gia y tế trước khi dùng; mang theo hộp và danh sách thuốc.", claimIds: [] },
  { id: "rich-q-label", productId: "rich", group: "rich-label", label: "Đọc hộp RICH: ba mục cần xem", angle: "Tên sản phẩm, hạn dùng, đối tượng không nên dùng (vị thành niên, mang thai, cho con bú).", claimIds: [] },
  { id: "rich-q-notmed", productId: "rich", group: "rich-notmed", label: "RICH không phải thuốc: vì sao điều này quan trọng?", angle: "Không chẩn đoán/điều trị/phòng bệnh; không thay thuốc; theo dõi cơ thể, thấy thay đổi thì ngừng và hỏi bác sĩ.", claimIds: [] },
  { id: "nano-q-why-support", productId: "nano", group: "nano-support", label: "Vì sao tôi nói 'hỗ trợ' chứ không nói 'chữa'?", angle: "Giải thích chữ 'hỗ trợ' trong hồ sơ đã xác nhận, nhắc NANO không phải thuốc; nếu nêu công dụng thì trích nguyên văn claim.", claimIds: ["NANO-01"] },
  { id: "nano-q-genuine", productId: "nano", group: "nano-genuine", label: "Mua NANO: kiểm tra gì để đúng hàng thật?", angle: "Đọc tên đầy đủ trên hộp, thông tin nhà sản xuất/nhập khẩu, mua ở nơi rõ ràng; không nêu công dụng.", claimIds: [] },
  { id: "nano-q-ask-doctor", productId: "nano", group: "nano-ask", label: "Mang hộp NANO đi khám: hỏi bác sĩ những gì?", angle: "Mang hộp và danh sách thuốc đang dùng, hỏi có phù hợp không; không tự quyết thay bác sĩ.", claimIds: [] },
  { id: "nano-q-habit", productId: "nano", group: "nano-habit", label: "Thói quen nhỏ cho đôi gối, kèm một lựa chọn hỗ trợ", angle: "Vận động vừa sức, giữ cân nặng; nhắc NANO như một lựa chọn hỗ trợ, trích nguyên văn claim.", claimIds: ["NANO-01"] },
  { id: "rich-q-why-support", productId: "rich", group: "rich-support", label: "RICH và chữ 'hỗ trợ' trong hồ sơ", angle: "Giải thích vì sao chỉ dùng câu chữ đã được xác nhận; trích nguyên văn claim, không suy diễn.", claimIds: ["RICH-02"] },
  { id: "rich-q-genuine", productId: "rich", group: "rich-genuine", label: "Mua RICH COENZYME Q10: kiểm tra gì trên hộp?", angle: "Tên sản phẩm, thông tin nhà sản xuất/nhập khẩu, hạn dùng; mua nơi rõ ràng; không nêu công dụng.", claimIds: [] },
  { id: "rich-q-who-not", productId: "rich", group: "rich-who", label: "Ai không nên tự dùng RICH?", angle: "Nhắc đúng cảnh báo: không dành cho trẻ vị thành niên, phụ nữ mang thai/cho con bú, người mắc bệnh; người đang dùng thuốc hỏi chuyên gia y tế.", claimIds: [] },
  { id: "rich-q-daily", productId: "rich", group: "rich-daily", label: "Một ngày nhiều năng lượng bắt đầu từ thói quen", angle: "Ngủ đủ, ăn uống, vận động; nhắc RICH như phần hỗ trợ, trích nguyên văn 'hỗ trợ bổ sung Coenzyme Q10 cho cơ thể'.", claimIds: ["RICH-01"] },
];
