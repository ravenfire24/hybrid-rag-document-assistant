import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Document QA",
  description: "Document QA with Next.js, Qdrant Cloud, and NVIDIA NIM models."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
