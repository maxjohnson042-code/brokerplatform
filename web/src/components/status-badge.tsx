import { cn } from "@/lib/utils";
import { getStatusMeta, type StatusDomain, type StatusMeaning } from "@/lib/status";

const MEANING_CLASSES: Record<StatusMeaning, string> = {
  success: "bg-status-success-bg text-status-success-fg",
  warning: "bg-status-warning-bg text-status-warning-fg",
  danger: "bg-status-danger-bg text-status-danger-fg",
  info: "bg-status-info-bg text-status-info-fg",
  neutral: "bg-status-neutral-bg text-status-neutral-fg",
};

// A small dot rather than colour-alone, so the meaning doesn't rely on colour vision
// alone (WCAG 1.4.1) — the badge text label carries the same information again, but
// the dot makes status scannable in a dense table without reading every label.
export function StatusBadge({
  domain,
  value,
  className,
}: {
  domain: StatusDomain;
  value: string;
  className?: string;
}) {
  const meta = getStatusMeta(domain, value);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        MEANING_CLASSES[meta.meaning],
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

// Profile and business status share the exact same label vocabulary (draft/submitted/
// verified/...), so two bare badges sitting next to each other — the review queue and
// broker panel rows, the broker-profile page's header + business list — read as two
// identical, unexplained "Submitted" pills. A short caption in front of each fixes
// that without touching the underlying vocabulary, which is fine on its own wherever
// only one badge is shown (the broker's own /profile, /business pages).
export function LabeledStatusBadge({
  label,
  domain,
  value,
}: {
  label: string;
  domain: StatusDomain;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <StatusBadge domain={domain} value={value} />
    </span>
  );
}
