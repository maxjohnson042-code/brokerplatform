import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Generic badge shell — variants are structural (solid/soft/outline), not semantic.
// Status colour comes from StatusBadge (components/status-badge.tsx), which is the
// only place a "what colour means what" decision should be made. Use this directly
// only for non-status labels (counts, tags).
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium gap-1",
  {
    variants: {
      variant: {
        soft: "bg-muted text-muted-foreground",
        outline: "border border-border text-foreground",
      },
    },
    defaultVariants: { variant: "soft" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
