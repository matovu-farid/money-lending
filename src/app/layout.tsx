import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
    { media: "(prefers-color-scheme: light)", color: "#f9f9fb" },
  ],
};

export const metadata: Metadata = {
  title: { default: "Sovereign Ledger", template: "%s | Sovereign Ledger" },
  description: "Loan portfolio management for money-lending operations.",
  applicationName: "Sovereign Ledger",
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "en_UG",
    title: "Sovereign Ledger",
    description: "Loan portfolio management for money-lending operations.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sovereign Ledger",
    description: "Loan portfolio management for money-lending operations.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
