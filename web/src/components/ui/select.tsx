import * as React from "react";
import { cn } from "@/lib/utils";

// A native <select>, styled to match Input/Button, rather than a Radix Select.
// Native gets keyboard behaviour, screen-reader semantics and mobile pickers for
// free, at the cost of less control over the open-dropdown's appearance — the right
// trade for form selects (state, association, document type) that don't need custom
// option rendering. Reach for a Radix-based combobox instead once a select needs
// search-as-you-type (e.g. a long lender list) — don't retrofit this one.
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-sm",
        "transition-colors hover:border-muted-foreground/40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background focus-visible:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";
