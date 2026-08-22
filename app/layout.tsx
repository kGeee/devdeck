import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "DevDeck — local project workspace",
  description:
    "Run, review and ship every local project: dev servers, git changes and GitHub pull requests in one place.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh antialiased" style={{ fontFamily: "var(--font-inter), var(--font-sans)" }}>
        {children}
      </body>
    </html>
  );
}
