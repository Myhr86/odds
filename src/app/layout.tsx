import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";

export const metadata: Metadata = {
  title: "Odds Intelligence",
  description: "Find the edge. Understand the odds. Analytical decision support for Norsk Tipping Oddsen.",
};
export const viewport: Viewport = { themeColor: "#0b0d10", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto flex max-w-[1400px] flex-col md:flex-row">
          <aside className="border-b border-line p-3 md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
            <div className="mb-3 px-3 md:mb-6">
              <div className="text-sm font-bold tracking-[0.2em]">ODDS INTELLIGENCE</div>
              <div className="text-xs text-muted">Find the edge. Understand the odds.</div>
            </div>
            <Nav />
          </aside>
          <main className="min-w-0 flex-1 p-4 md:p-6">
            {children}
            <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-muted">
              Analytical decision support only. EV and confidence are estimates, not certainties, and past results do not guarantee future results.
              No bets are placed by this tool, and no Norsk Tipping credentials are ever stored. Norsk Tipping prices are entered manually; reference odds come from an independent third party.
              Need help with gambling? Hjelpelinjen: 800 800 40.
            </footer>
          </main>
        </div>
      </body>
    </html>
  );
}
