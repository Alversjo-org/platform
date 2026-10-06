import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
const description =
  "Alversjö is a place for co-creation and exploration, in close collaboration with nature and wildlife.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Alversjö",
  description,
  openGraph: {
    title: "Alversjö",
    description,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Alversjö",
    description,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
