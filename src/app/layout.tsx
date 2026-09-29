import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import AppShell from "../components/AppShell";
import { ThemeProvider } from "../components/ThemeProvider";
import AuthGuard from "../components/AuthGuard";
import ServiceWorkerRegister from "../components/ServiceWorkerRegister";
import OfflinePrecache from "../components/OfflinePrecache";
import "./globals.css";

/**
 * Fuentes locales, no `next/font/google`: con Google, `next build` descarga las fuentes en medio
 * del build y, si esa descarga se corta, aborta el deploy entero. Mismos archivos que entregaba
 * Google (subset latino, fuentes variables). Licencia OFL.
 */
const plusJakarta = localFont({
  src: "./fonts/plus-jakarta-sans-latin.woff2",
  variable: "--font-plus-jakarta",
  weight: "300 800",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ferretería República",
  description: "Sistema de gestión Zentra — Ferretería República",
  applicationName: "Ferretería República",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Ferretería" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0B3A3D",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={`${plusJakarta.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          <AuthGuard>
            <AppShell>{children}</AppShell>
          </AuthGuard>
        </ThemeProvider>
        <ServiceWorkerRegister />
        <OfflinePrecache />
      </body>
    </html>
  );
}
