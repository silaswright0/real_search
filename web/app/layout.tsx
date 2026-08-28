import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import { CSRF_COOKIE } from "@/lib/auth-constants";
import { CsrfProvider } from "@/lib/csrf-context";
import { cookies, headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "real search",
  description: "Personal search: web via SearXNG over Tor, peer-to-peer via local YaCy.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const nonce = (await headers()).get("x-nonce") ?? "";
  const csrfToken = (await cookies()).get(CSRF_COOKIE)?.value ?? "";
  return (
    <html
      lang="en"
      data-theme="web"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {nonce ? <script nonce={nonce} /> : null}
      </head>
      <body className="min-h-full flex flex-col">
        <CsrfProvider token={csrfToken}>
          <AppShell>{children}</AppShell>
        </CsrfProvider>
      </body>
    </html>
  );
}
