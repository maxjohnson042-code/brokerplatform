import { cn } from "@/lib/utils";

// The product's name is a wordmark, not a name-plus-icon lockup: "brok3r", all
// lowercase, with the "3" carrying the brand's fixed blue regardless of light/dark
// mode (a logo's accent colour shouldn't flip with the theme — only the neutral
// strokes do, via text-foreground, so the mark stays legible on either background).
// A geometric/rounded system font stack gets close to the reference mark without
// pulling in a web font — see layout.tsx's comment on why this app avoids those.
const WORDMARK_FONT = '"Century Gothic", Futura, "Avenir Next", "Trebuchet MS", ui-rounded, sans-serif';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("font-bold leading-none tracking-tight text-foreground", className)}
      style={{ fontFamily: WORDMARK_FONT }}
    >
      brok<span className="text-[#2563eb]">3</span>r
    </span>
  );
}
