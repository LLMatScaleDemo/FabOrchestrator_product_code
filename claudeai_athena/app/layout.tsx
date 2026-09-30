import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "@/components/providers";
import { INSTALLED_APP_SCRIPT } from "@/lib/installed-app";
import "./globals.css";
import "./artifact-panel.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LLMatscale.ai - AI Chat Application",
  description: "AI chat application powered by Claude",
  keywords: ["AI", "chat", "Claude", "MCP", "assistant"],
  authors: [{ name: "LLMatscale.ai" }],
  robots: "noindex, nofollow",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // WCAG 1.4.4 / 1.4.10: never disable user zoom. Allow pinch-to-zoom on mobile.
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF9F5" },
    { media: "(prefers-color-scheme: dark)", color: "#262624" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="fab-blue" className="h-full overflow-hidden">
      <head>
        {/* Marks the installed app (`data-installed-app`) before first paint,
            so its phone navigation never flashes in after the browser layout.
            See lib/installed-app.ts. */}
        <script dangerouslySetInnerHTML={{ __html: INSTALLED_APP_SCRIPT }} />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased h-full overflow-hidden`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
