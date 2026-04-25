import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lambda Cloud GPU availability",
  description:
    "Poll Lambda Cloud capacity, list running instances, launch or terminate, and copy SSH commands.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
