export const metadata = { title: "Chính sách quyền riêng tư – Việt Đức Sống Khỏe" };

/** Trang chính sách quyền riêng tư (Meta yêu cầu khi chuyển app sang chế độ Live). */
export default function Privacy() {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 16px", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 26 }}>Chính sách quyền riêng tư</h1>
      <p>Ứng dụng &quot;Viet Duc Auto&quot; là công cụ nội bộ của Fanpage <b>Việt Đức – Khoẻ Trẻ Đẹp</b>, dùng để soạn và đăng bài lên chính Fanpage này theo lịch.</p>
      <h2 style={{ fontSize: 20 }}>Dữ liệu chúng tôi xử lý</h2>
      <ul>
        <li>Mã truy cập của Fanpage (Page Access Token), chỉ để đăng bài lên Fanpage của chính chủ sở hữu.</li>
        <li>Nội dung bài viết, hình ảnh, thời gian đăng và mã bài đăng (Post ID) do ứng dụng tạo ra.</li>
      </ul>
      <p>Ứng dụng <b>không</b> thu thập, lưu trữ hay chia sẻ dữ liệu cá nhân của người dùng Facebook, người theo dõi hoặc khách hàng. Ứng dụng không đọc tin nhắn, bình luận hay thông tin hồ sơ của bất kỳ ai.</p>
      <h2 style={{ fontSize: 20 }}>Lưu trữ và bảo mật</h2>
      <p>Mã truy cập được lưu dưới dạng biến môi trường bí mật trên máy chủ. Nhật ký đăng bài chỉ dùng cho chủ sở hữu Fanpage theo dõi hoạt động.</p>
      <h2 style={{ fontSize: 20 }}>Xoá dữ liệu</h2>
      <p>Chủ sở hữu có thể thu hồi quyền của ứng dụng bất cứ lúc nào trong phần Cài đặt Facebook → Doanh nghiệp tích hợp. Mọi yêu cầu xoá dữ liệu xin gửi về: vietduc.nhadatdian@gmail.com.</p>
      <p style={{ color: "#666", fontSize: 14 }}>Cập nhật: 20/10/2026</p>
    </main>
  );
}
