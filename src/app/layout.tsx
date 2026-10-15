import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DocumentPrefs } from "@/ui/theme/document-prefs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ParaNaga · Know your ride in Naga City",
    template: "%s · ParaNaga",
  },
  description:
    "Where to wait, which jeepney to take, where to transfer and when to say Para! Step-by-step commuting in Naga City, Camarines Sur.",
  applicationName: "ParaNaga",
};

export const viewport: Viewport = {
  themeColor: "#0f1e3d",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // public/theme-init.js sets data-theme / data-contrast on <html> before the first paint (from
    // the device preferences), so the attributes differ from the server render on purpose.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Must block: it runs before the first paint so a Dark choice never flashes light. A
            same-origin file (not inline) so it passes script-src 'self'. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
      </head>
      <body className="min-h-full flex flex-col">
        <DocumentPrefs />
        {children}
      </body>
    </html>
  );
}
