/**
 * Ảnh THẬT chụp sản phẩm (assets/photos, do chủ page cung cấp từ thư mục Drive sản phẩm) cho bài kiểu
 * "thẻ chữ lớn ở trên + 2 ảnh bên dưới". Chỉ cắt khung vuông, không chỉnh sửa bao bì.
 */
export const PRODUCT_PHOTOS: Record<string, string[]> = {
  nano: ["sun-1.jpg", "sun-2.jpg", "sun-3.jpg"],
  rich: ["rich-1.jpg", "rich-2.jpg", "rich-3.jpg"],
  dha: ["dha-1.jpg", "dha-2.jpg", "dha-3.jpg"],
};

/** Chọn 2 ảnh khác nhau, xoay vòng theo seed (ngày + khung giờ) để các bài liên tiếp không dùng cùng cặp ảnh. */
export function pickPhotos(productId: string | undefined, seed: number): string[] | null {
  const list = productId ? PRODUCT_PHOTOS[productId] : undefined;
  if (!list || list.length < 2) return null;
  const i = ((seed % list.length) + list.length) % list.length;
  return [list[i], list[(i + 1) % list.length]];
}
