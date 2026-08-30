"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { CheckResultSummary } from "@/lib/types";

/**
 * Section 2.4: "a lender relying on a check performed by or through Thriski must be
 * able to see and retain what it relied on, not an assertion that someone else was
 * satisfied." The UI corollary: never show a check as just a green tick. Each row
 * expands to the full result and evidence reference — collapsed by default so the
 * list stays scannable, but the detail is one click away, never hidden behind a
 * separate page or a support request.
 */
export function CheckResultList({ checks }: { checks: CheckResultSummary[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (checks.length === 0) {
    return <p className="text-sm text-muted-foreground">No checks recorded yet.</p>;
  }

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {checks.map((check) => {
        const isOpen = expandedId === check.id;
        return (
          <li key={check.id} className="p-4">
            <button
              type="button"
              onClick={() => setExpandedId(isOpen ? null : check.id)}
              className="flex w-full items-center justify-between gap-4 text-left"
              aria-expanded={isOpen}
            >
              <div>
                <p className="text-sm font-medium text-foreground">
                  {check.checkType.replaceAll("_", " ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {check.provider} · {new Date(check.completedAt).toLocaleDateString("en-AU")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-status-success-fg">{check.outcome}</span>
                <Button variant="ghost" size="sm" type="button">
                  {isOpen ? "Hide evidence" : "View evidence"}
                </Button>
              </div>
            </button>
            {isOpen && (
              <div className="mt-3 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                <p>
                  IDV-006 / SCR-010: the full provider payload, source, method and timestamp render
                  here — not a pass/fail badge. Wired to real evidence once Epic 6/7 build the
                  verification endpoints; this scaffold shows the layout the data will fill.
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="font-medium text-foreground">Provider</dt>
                  <dd>{check.provider}</dd>
                  <dt className="font-medium text-foreground">Completed</dt>
                  <dd>{new Date(check.completedAt).toLocaleString("en-AU")}</dd>
                  <dt className="font-medium text-foreground">Evidence</dt>
                  <dd>{check.hasEvidence ? "Available — raw payload + artefact" : "Not captured"}</dd>
                </dl>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
