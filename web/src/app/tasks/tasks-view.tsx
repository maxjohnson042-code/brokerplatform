"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  getStoredToken,
  getOutstandingSummary,
  type OutstandingSummaryItem,
} from "@/lib/thriski-api";

const SOURCE_LABELS: Record<OutstandingSummaryItem["source"], string> = {
  profile: "My profile",
  business: "My business",
  accreditation: "Accreditations",
};

function linkFor(item: OutstandingSummaryItem): string {
  if (item.source === "profile") return "/profile";
  if (item.source === "business") return "/business";
  return `/accreditations/${item.sourceId}`;
}

type Group = { sourceId: string; sourceLabel: string; items: OutstandingSummaryItem[] };

export function TasksView() {
  const router = useRouter();
  const [items, setItems] = useState<OutstandingSummaryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (token: string) => {
    setItems(await getOutstandingSummary(token));
  }, []);

  useEffect(() => {
    const stored = getStoredToken();
    if (!stored) {
      router.replace("/login");
      return;
    }
    refresh(stored).catch((err) => {
      setError(err instanceof ApiError ? err.message : "Could not load outstanding tasks.");
    });
  }, [router, refresh]);

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm text-muted-foreground">Loading your outstanding tasks…</p>
      </div>
    );
  }

  const bySource = new Map<OutstandingSummaryItem["source"], Map<string, Group>>();
  for (const item of items) {
    if (!bySource.has(item.source)) bySource.set(item.source, new Map());
    const groups = bySource.get(item.source)!;
    if (!groups.has(item.sourceId)) groups.set(item.sourceId, { sourceId: item.sourceId, sourceLabel: item.sourceLabel, items: [] });
    groups.get(item.sourceId)!.items.push(item);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Outstanding tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          PRF-003. Everything still outstanding across your profile, business and accreditations, in one place.
        </p>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-status-success-fg">Nothing outstanding.</CardContent>
        </Card>
      ) : (
        (["profile", "business", "accreditation"] as const).map((source) => {
          const groups = bySource.get(source);
          if (!groups || groups.size === 0) return null;
          return (
            <div key={source}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {SOURCE_LABELS[source]}
              </h2>
              <div className="space-y-3">
                {Array.from(groups.values()).map((group) => (
                  <Link key={group.sourceId} href={linkFor(group.items[0])}>
                    <Card className="transition-colors hover:bg-muted/50">
                      <CardHeader>
                        <CardTitle>{group.sourceLabel}</CardTitle>
                        <CardDescription>
                          {group.items.length} outstanding item{group.items.length === 1 ? "" : "s"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1.5">
                          {group.items.map((item) => (
                            <li key={item.groupId} className="text-sm">
                              <span className="font-medium text-foreground">{item.label}</span>
                              <span className="text-muted-foreground"> — {item.reason}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
