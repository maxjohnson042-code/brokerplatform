import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

/**
 * Wraps one form control with a label, optional hint text, and an error message slot
 * that's reserved (via min-height) whether or not there's an error — so a validation
 * error appearing doesn't shift every field below it down the page, which is the kind
 * of small thing that makes a long compliance form feel stable rather than jumpy.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="text-destructive" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </Label>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
      <p className="min-h-4 text-xs text-destructive" role="alert">
        {error}
      </p>
    </div>
  );
}
