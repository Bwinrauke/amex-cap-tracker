import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "4x Cap Runway",
  description:
    "Track Amex Business Gold 4x bonus-category spend against each account's $150,000 calendar-year cap.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
