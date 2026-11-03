import type { Metadata } from "next";
import { Geist_Mono, Inter, Newsreader } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Stand-in for Iowan Old Style (Apple-only), which the design was drawn in.
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
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
      className={`${inter.variable} ${newsreader.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
