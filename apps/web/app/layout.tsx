import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChaosMonkey AI",
  description: "Crash-test AI agents before customers do.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="grid-bg font-sans antialiased">
        <header className="border-b border-graphite-800 bg-graphite-950/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-fault font-mono text-sm font-black text-graphite-950">
                C
              </span>
              <span className="text-sm font-semibold tracking-wide text-graphite-100">
                ChaosMonkey <span className="text-fault">AI</span>
              </span>
            </Link>
            <span className="hidden text-xs text-graphite-400 sm:block">Crash-test AI agents before customers do.</span>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
