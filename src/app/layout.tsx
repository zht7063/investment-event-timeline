import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "投资事件证据时间线",
  description: "追踪投资事件的来源、事实变化、证据冲突与当前结论",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <a className="skip" href="#main">跳到正文</a>
        <header className="masthead">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden="true">§</span>
            证据时间线
          </Link>
          <nav aria-label="主导航">
            <Link href="/">事件</Link>
            <Link href="/import">导入资料</Link>
            <Link href="/sources">数据源</Link>
          </nav>
        </header>
        <main id="main">{children}</main>
        <footer className="colophon">
          时间均为北京时间（UTC+8）。本工具整理证据与来源，不构成投资建议，不预测涨跌。
        </footer>
      </body>
    </html>
  );
}
