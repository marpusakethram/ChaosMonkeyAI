import "@fontsource-variable/figtree";
import type { Metadata } from "next";
import { SiteNav } from "@/components/site-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChaosMonkey AI",
  description: "Crash-test AI agents before customers do.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-body antialiased">
        <SiteNav />
        <main className="mx-auto max-w-page px-4 pb-24 pt-8 sm:px-8 sm:pt-10">{children}</main>
        <footer className="border-t border-line-soft">
          <div className="mx-auto flex max-w-page flex-col gap-2 px-4 py-8 text-caption text-ink-steel sm:flex-row sm:justify-between sm:px-8">
            <span>ChaosMonkey AI runs bundled agents against fictional fixtures. No third-party systems are contacted.</span>
            <span>Local evaluation build</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
