import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SISBAR — Sistema Integrado de Bar",
  description: "Catálogo, retiradas, estoque e recebimentos da geladeira da empresa.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
