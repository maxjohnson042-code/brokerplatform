import { cn } from "@/lib/utils";

// The real wordmark (public/brok3r-logo.png, transparent background) — previously
// approximated with a system-font span since no logo asset existed yet (see git
// history on this file for that version). Fixed dark navy + blue "3" baked into the
// image itself, not theme-reactive — same call the previous approximation made
// (a logo's accent colour shouldn't flip with light/dark mode).
export function BrandMark({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brok3r-logo.png" alt="brok3r" className={cn("h-6 w-auto", className)} />
  );
}
