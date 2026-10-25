import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "投资事件证据时间线",
  description: "追踪投资事件的来源、事实变化、证据冲突与当前结论",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
