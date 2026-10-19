/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ảnh/phông chữ thật nằm trong /assets, đọc bằng fs lúc chạy -> phải đưa vào bundle của route ảnh
  outputFileTracingIncludes: {
    "/api/image/[id]": ["./assets/**/*"],
  },
};
export default nextConfig;
