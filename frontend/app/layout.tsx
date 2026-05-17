import type { Metadata } from "next";
import { Space_Grotesk, Bebas_Neue } from "next/font/google";
import { QueryProvider } from "./providers/QueryProvider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-bebas-neue",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Skill Hub",
  description: "A marketplace for AI services",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${bebasNeue.variable}`}>
      <body className="min-h-screen antialiased">
        <QueryProvider>
          <div className="mx-auto w-full" style={{ maxWidth: "1450px" }}>
            {children}
          </div>
        </QueryProvider>
      </body>
    </html>
  );
}
