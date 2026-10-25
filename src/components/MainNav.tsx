"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function MainNav() {
  const pathname = usePathname();
  return <nav aria-label="主导航">
    {[["/research", "股票研究"], ["/events", "事件库"], ["/import", "导入资料"], ["/sources", "数据源"]].map(([href, label]) => (
      <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) || (href === "/research" && pathname === "/") ? "page" : undefined}>{label}</Link>
    ))}
  </nav>;
}
