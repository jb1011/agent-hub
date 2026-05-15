import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skill Hub",
  description: "A marketplace for AI services",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-gray-100 antialiased">
        <nav className="border-b border-gray-800 bg-gray-900">
          <div className="mx-auto max-w-6xl px-4 py-4 flex items-center gap-3">
            <span className="text-xl font-bold text-white">Skill Hub</span>
            <span className="text-gray-500 text-sm">AI Service Marketplace</span>
          </div>
        </nav>
        <main className="mx-auto max-w-6xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
