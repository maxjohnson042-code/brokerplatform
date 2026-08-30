"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { allStatusesFor } from "@/lib/status";
import type { BrokerProfileSummary } from "@/lib/types";

const STATUS_OPTIONS = allStatusesFor("profile");

function relativeDate(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * REV-001: "a work queue filterable by status, type, product scope and age." This
 * scaffold implements status + free-text search — product scope and age-based
 * filtering are straightforward additions once Epic 10 defines what "type" means for
 * a real accreditation record (this table currently shows broker profiles, not
 * per-lender accreditation requests, since accreditation doesn't exist yet).
 */
export function QueueTable({ brokers }: { brokers: BrokerProfileSummary[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");

  const filtered = useMemo(() => {
    return brokers.filter((b) => {
      const matchesStatus = status === "all" || b.status === status;
      const haystack = `${b.firstName} ${b.lastName} ${b.email}`.toLowerCase();
      const matchesQuery = haystack.includes(query.toLowerCase());
      return matchesStatus && matchesQuery;
    });
  }, [brokers, query, status]);

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          placeholder="Search name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="sm:max-w-xs"
          aria-label="Search brokers"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="sm:max-w-52"
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        <p className="text-xs text-muted-foreground sm:ml-auto">
          {filtered.length} of {brokers.length}
        </p>
      </div>

      <div className="mt-4 rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Broker</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Outstanding</TableHead>
              <TableHead>Registered</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((b) => (
              <TableRow key={b.id}>
                <TableCell>
                  <Link href={`/reviewer/brokers/${b.id}`} className="block hover:underline">
                    <p className="font-medium text-foreground">
                      {b.firstName} {b.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">{b.email}</p>
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge domain="profile" value={b.status} />
                </TableCell>
                <TableCell>
                  {b.business ? (
                    <div>
                      <p className="text-sm text-foreground">{b.business.legalName}</p>
                      <StatusBadge domain="business" value={b.business.status} className="mt-1" />
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not yet affiliated</span>
                  )}
                </TableCell>
                <TableCell>
                  {b.outstandingItems.length > 0 ? (
                    <Badge>{b.outstandingItems.length} item{b.outstandingItems.length > 1 ? "s" : ""}</Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{relativeDate(b.createdAt)}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  No brokers match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
