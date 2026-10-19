import type { ReactNode } from "react";

export const metadata = { title: "Việt Đức – Đăng bài tự động", robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: "#faf8f2", color: "#111" }}>{children}</body>
    </html>
  );
}
