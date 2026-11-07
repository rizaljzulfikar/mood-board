import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoodBoard — collaborative moodboards",
  description: "Multi-user infinite canvas moodboard. PureRef, but in the browser.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
