import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";

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
  applicationName: "DevDeck",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "DevDeck",
    // The UI is a near-black dark surface; a translucent bar would show the
    // page scrolling underneath it.
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  // The app is a full-height workspace with its own scroll regions; letting the
  // page itself zoom or rubber-band fights the panes.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body
        className="min-h-dvh antialiased"
        style={{ fontFamily: "var(--font-inter), var(--font-sans)" }}
      >
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
