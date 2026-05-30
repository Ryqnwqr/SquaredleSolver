"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SiteLogo } from "./SiteLogo";

const NAV = [{ href: "/solver", label: "Solver" }] as const;

export function TopBar() {
  const pathname = usePathname();

  return (
    <header className="top-bar">
      <div className="top-bar__inner">
        <Link href="/solver" className="top-bar__brand">
          <SiteLogo className="site-logo site-logo--compact" />
          <span>Squaredle Solver</span>
        </Link>
        <nav className="top-bar__nav" aria-label="Main">
          {NAV.map(({ href, label }) => {
            const active =
              pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`top-bar__link${active ? " top-bar__link--active" : ""}`}
                aria-current={active ? "page" : undefined}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="top-bar__end" aria-hidden />
      </div>
    </header>
  );
}
