import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";

// Deliberately NOT next/font/google (Geist): that fetches font files from
// fonts.googleapis.com at build time, which failed in the sandbox this scaffold was
// built in and may fail again in a locked-down CI/build environment. A system-font
// stack (defined in globals.css as --font-sans/--font-mono) renders instantly, needs
// no network at build time, and is a legitimate, common choice for a compliance
// product where legibility matters more than a branded typeface. Swap in next/font/
// local with a licensed font file if the product needs a distinct type identity later
// — that's a one-file change (globals.css's --font-sans), not a rearchitecture.
export const metadata: Metadata = {
  title: "Thriski",
  description: "Broker onboarding, accreditation and ongoing monitoring platform",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
