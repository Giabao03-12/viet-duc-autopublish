# Việt Đức – Sống Khỏe · Hệ thống đăng bài tự động

Chạy trên Vercel (không cần mở máy tính). Mặc định **TẮT** – chỉ bật sau khi bạn kiểm tra, đăng thử và gõ xác nhận.

## Cách hoạt động

| Giờ VN | Việc | Cơ chế |
|---|---|---|
| 03:00 | Chuẩn bị bài 06:00 | Vercel Cron → chọn chủ đề → Claude viết (3 tiêu đề) → kiểm duyệt (tối đa 3 lần sửa) → tạo ảnh → **hẹn giờ trên Facebook** |
| 15:00 | Chuẩn bị bài 18:00 | như trên, bài sản phẩm (luân phiên NANO / RICH ngày chẵn-lẻ) |
| 06:00 / 18:00 | Đăng | **Facebook tự đăng đúng giờ** (scheduled_publish_time) – không phụ thuộc độ trễ của cron |
| 06:30 / 18:30 | Watchdog | Đối soát đã đăng, lưu Post ID, kiểm tra token, báo lỗi |

Vì sao hẹn giờ ngay trên Facebook: cron của Vercel gói Hobby có thể lệch tới ~1 giờ. Cron chỉ “chuẩn bị”, giờ đăng do Facebook giữ nên luôn đúng phút.

Cron chạy theo UTC (vercel.json): `0 20 * * *` = 03:00 VN, `0 8 * * *` = 15:00 VN, `30 23` = 06:30 VN, `30 11` = 18:30 VN.

## Các luật cứng (code, không phụ thuộc AI) – `lib/compliance.ts`
Chặn: cam kết/chữa khỏi, thay/ngưng thuốc, điều trị/chẩn đoán, tái tạo sụn, đột quỵ/huyết khối…, chứng nhận/nghiên cứu/số liệu %, giá/khuyến mãi, lời khách/bác sĩ khuyên, nhắc sản phẩm ngoài hồ sơ. Bài 06:00 không được nhắc sản phẩm. Bài 18:00 chỉ nêu công dụng bằng **claim nguyên văn đã duyệt**. Cảnh báo “không phải là thuốc…” + số XNQC do **hệ thống gắn**, AI không tự viết. Kiểm duyệt AI lỗi = **không đăng**. Quá 3 lần sửa = bỏ lượt + báo. Mỗi (ngày, khung giờ) có khoá chống trùng; cron muộn (<15 phút) = bỏ lượt, **không đăng bù**.

> Đây là lớp an toàn kỹ thuật dựa trên Claim Registry của bạn, **không phải ý kiến pháp lý**. Hãy nhờ người hiểu quy định quảng cáo TPBVSK xem lại bộ luật trong `lib/compliance.ts` và các cảnh báo trong `lib/catalog.ts`.

## Việc BẠN phải quyết định (hệ thống không tự làm)
1. **Duyệt claim**: đặt `APPROVED_CLAIMS=NANO-01,RICH-01,RICH-02,RICH-03` (chỉ những dòng bạn đồng ý). Chưa đặt → bài 18:00 chỉ dùng chủ đề không nêu công dụng.
2. **Ảnh chân dung**: xác nhận `assets/portraits/viet-duc-01.png` đúng là bạn → `PORTRAIT_CONFIRMED=1`. Chưa → bài 06:00 không có ảnh người.
3. **Trùng lịch cũ**: task Claude Code `viet-duc-content-post-scheduler` (06:00/18:00) đang bật và đăng cùng Page cùng giờ. Hãy tắt nó khi bật hệ thống này (và cân nhắc lịch video 07:00/19:00 – hiện sẽ thành 4 bài/ngày).

## Cài đặt từng bước

### 1. Claude API
console.anthropic.com → API Keys → tạo key → `ANTHROPIC_API_KEY`. (Mô hình mặc định `claude-sonnet-5-5`, đổi bằng `ANTHROPIC_MODEL`.)

### 2. Meta (Facebook)
1. developers.facebook.com → My Apps → Create App → loại **Business**.
2. Thêm quyền `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`. Tài khoản của bạn phải là **Admin** của Page và là admin/developer của app (đăng lên Page của chính bạn không cần App Review).
3. Graph API Explorer → chọn app → lấy User Token với 3 quyền trên.
4. Đổi sang token dài hạn: `GET /oauth/access_token?grant_type=fb_exchange_token&client_id=APP_ID&client_secret=APP_SECRET&fb_exchange_token=USER_TOKEN`.
5. `GET /me/accounts` bằng token dài hạn → lấy `access_token` của Page “Việt Đức - Khoẻ Trẻ Đẹp” (ID 1315954481600103) → đây là `META_PAGE_ACCESS_TOKEN` (không hết hạn).
6. Điền `META_PAGE_ID`, `META_APP_ID`, `META_APP_SECRET` (để hệ thống tự kiểm tra hạn token).
Không gửi token trong chat; chỉ nhập vào Vercel.

### 3. Vercel
1. Đưa thư mục này lên GitHub riêng tư (hoặc `npx vercel` trong thư mục).
2. Vercel → Add New Project → chọn repo.
3. **Storage → Marketplace → Upstash Redis** → kết nối (tự điền `KV_REST_API_URL/TOKEN`).
4. Settings → Environment Variables: điền theo `.env.example` (`PUBLIC_BASE_URL` = địa chỉ https của app; `CRON_SECRET`, `SESSION_SECRET` = chuỗi ngẫu nhiên dài; `ADMIN_PASSWORD`).
5. Deploy. Cron trong `vercel.json` tự bật.
Gói: Hobby không dành cho mục đích thương mại; Pro mới đảm bảo điều khoản và có Cron chính xác theo phút. Với Page kinh doanh nên dùng **Pro**.

### 4. Thông báo
Zapier → Zap “Catch Hook” → Gmail gửi cho bạn → dán URL vào `NOTIFY_WEBHOOK_URL`. (Tuỳ chọn thêm Telegram bot.)

### 5. Giám sát “hệ thống dừng”
UptimeRobot/BetterStack theo dõi `https://<app>/api/health` (trả 503 khi đang BẬT mà watchdog im lặng >20 giờ) và gửi báo cho bạn. Đây là cách duy nhất báo được khi chính Vercel/cron ngừng.

### 6. Canva
Không bắt buộc: ảnh được dựng ngay trong app (bộ màu vàng/đỏ/đen, font Be Vietnam Pro, ảnh sản phẩm/người thật đặt nguyên vẹn, **không dùng AI sinh ảnh** nên không đổi mặt/bao bì). Nếu sau này muốn dùng mẫu Canva, kết nối Canva là bước riêng do bạn tự cấp quyền.

## Trình tự kích hoạt (trong trang điều khiển `/`)
1. Đăng nhập → **1. Kiểm tra kết nối & cấu hình** (phải ra “ĐẠT”).
2. **2a / 2b. Tạo thử bài** → đọc caption + ảnh + nhật ký kiểm duyệt.
3. **3. Đăng thử** một bài (bạn gõ “ĐĂNG THỬ”) → xem trên Fanpage, xoá nếu muốn.
4. Bấm **BẬT** và gõ “KÍCH HOẠT”. Muốn dừng: bấm **TẮT** → các bài đã hẹn trong tương lai bị huỷ trên Facebook.

## Chạy thử trên máy
`npm install`, tạo `.env.local` (xem `.env.example`; đặt `MOCK_LLM=1 MOCK_META=1` để chạy giả lập), `npm run dev` → http://localhost:3300. `npm test` chạy 53 kiểm thử logic.
Bản giả lập chỉ để thử quy trình – văn phong thật chỉ có khi dùng Claude API.

## Giới hạn đã biết
- Kho chủ đề (`lib/catalog.ts`): 25 bài giáo dục + 10 chủ đề sản phẩm; hết một vòng hệ thống quay lại và báo bạn bổ sung.
- Kiểm tra chính tả tiếng Việt dựa vào luật cơ bản + bước duyệt của Claude; không thay người đọc lại.
- Claim `NANO-01`, `RICH-01..03` hiện ở trạng thái “chờ bạn duyệt lần cuối” theo `personal-brand-ai`; nhãn NANO còn mâu thuẫn hạn dùng (24 vs 36 tháng) – hệ thống không nêu hạn dùng.
- Chưa thử với Meta/Claude thật (chưa có khoá); mọi thứ khác đã chạy được ở chế độ giả lập.
