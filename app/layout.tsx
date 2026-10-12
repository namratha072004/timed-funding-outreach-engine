import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { paletteFrom, themeFrom } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = { title: "Funding Outreach", description: "Timed funding outreach drafts", robots: { index: false, follow: false } };

// With no theme cookie yet, follow the system theme before the first paint.
const SYSTEM_THEME = `try{var d=document.documentElement;if(!d.dataset.theme)d.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  return (
    <html lang="en" className={inter.variable} data-theme={themeFrom(jar.get("theme")?.value)} data-palette={paletteFrom(jar.get("palette")?.value)} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME }} /></head>
      <body>{children}</body>
    </html>
  );
}
