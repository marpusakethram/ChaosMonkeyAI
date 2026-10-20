"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CrashMark } from "@/components/crash-mark";
import { api, type Health } from "@/lib/api";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "New test", match: (p: string) => p === "/" },
  { href: "/runs", label: "Run history", match: (p: string) => p.startsWith("/runs") },
];

export function SiteNav() {
  const path = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setDown(true));
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-line-soft bg-canvas/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-page items-center gap-6 px-4 sm:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-subtitle font-bold text-ink-deep">
          <CrashMark />
          <span className="hidden sm:inline">ChaosMonkey AI</span>
        </Link>
        <nav className="flex items-center gap-2" aria-label="Main">
          {TABS.map((t) => {
            const active = t.match(path);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-2 text-body-sm font-bold transition-colors",
                  active ? "bg-ink-deep text-white" : "border border-line text-ink hover:bg-cloud",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto hidden items-center gap-2 text-body-sm text-ink-steel md:flex" data-testid="env-status">
          <span
            className={cn("h-2 w-2 rounded-full", down ? "bg-fail" : health ? "bg-pass" : "bg-line")}
            aria-hidden
          />
          {down
            ? "API unreachable on :8000"
            : !health
              ? "Connecting"
              : health.gemini_enabled
                ? `Connected, Gemini ${health.gemini_model} available`
                : "Connected, offline fixtures only"}
        </div>
      </div>
    </header>
  );
}
