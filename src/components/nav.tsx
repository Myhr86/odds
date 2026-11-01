"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  ["/", "Dashboard"],
  ["/value-finder", "Value Finder"],
  ["/odds-movement", "Odds Movement"],
  ["/match-analyzer", "Match Analyzer"],
  ["/watchlist", "Watchlist"],
  ["/history", "Historical Performance"],
  ["/coupon-builder", "Coupon Builder"],
  ["/settings", "Settings"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {ITEMS.map(([href, label]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${active ? "bg-panel-2 text-white" : "text-muted hover:text-zinc-200"}`}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
