import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "4x Cap Runway",
  description:
    "Track bonus-category spend against each card's annual cap, and route every charge to whichever card earns the most points.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
