import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./uca.css";
import "./workshop.css";
import "./welcome.css";
import { MotionProvider } from "@/components/motion-preferences";

export const metadata: Metadata = {
  title: "Almox ERP · U.C.A.",
  description:
    "Gestão de materiais, ordens e estoque por unidade · Grupo Capacle / U.C.A.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Almox ERP", statusBarStyle: "default" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#242528",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
