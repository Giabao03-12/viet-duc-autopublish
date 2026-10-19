export type SlotId = "0600" | "1800";
export type SlotKind = "education" | "product";

export type PostStatus =
  | "draft" // chạy thử, không đăng
  | "scheduled" // đã hẹn giờ trên Facebook
  | "posted" // Facebook xác nhận đã đăng
  | "skipped" // không đạt kiểm duyệt / thiếu thông tin
  | "failed" // lỗi API / quá giờ mà chưa đăng
  | "cancelled"; // bị huỷ khi tắt chế độ tự động

export interface Post {
  id: string;
  slot: SlotId;
  kind: SlotKind;
  date: string; // YYYY-MM-DD (giờ Việt Nam) của khung giờ đăng
  publishAt: string; // ISO
  status: PostStatus;
  dryRun: boolean;
  productId?: string;
  topicId: string;
  topicLabel: string;
  titles: string[]; // 3 tiêu đề
  title: string; // tiêu đề được chọn
  caption: string;
  hashtags: string[];
  claimIds: string[];
  imageUrl?: string;
  imageKind: "education" | "product";
  attempts: number; // số lần soạn/sửa
  complianceLog: string[]; // kết quả từng vòng kiểm
  fbPostId?: string;
  fbPermalink?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  autoEnabled: boolean;
  updatedAt: string;
  updatedBy: string;
  preflightOkAt?: string; // lần cuối preflight đạt
  testPostOkAt?: string; // lần đăng thử được chủ page cho phép và thành công
  lastPrepare?: Partial<Record<SlotId, string>>;
}

export interface LogEntry {
  t: string;
  level: "info" | "warn" | "error";
  event: string;
  msg: string;
  data?: unknown;
}
