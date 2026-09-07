"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "@/components/founder-dashboard.module.css";

const links = [
  { href: "/founder/overview", label: "Overview" },
  { href: "/founder/study-profile", label: "Study Profile" },
  { href: "/founder/reliability", label: "Reliability" },
  { href: "/founder/testers", label: "Testers" },
] as const;

export function FounderNav() {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="Founder dashboard">
      {links.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            className={active ? styles.navActive : undefined}
            href={link.href}
            aria-current={active ? "page" : undefined}
            key={link.href}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
