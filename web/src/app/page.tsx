import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DESTINATIONS = [
  {
    href: "/design-system",
    title: "Design system",
    description: "Every colour token and status mapping in one reference page — start here.",
  },
  {
    href: "/register",
    title: "Broker registration",
    description: "The broker-facing onboarding form (ONB-001–012): easy, forgiving, draft-friendly.",
  },
  {
    href: "/reviewer/queue",
    title: "Reviewer queue",
    description: "The lender review workbench (REV-001/002): dense, filterable, evidence-first.",
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Thriski frontend foundations</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        This scaffold proves the design system and two representative screens end to end. It reads from
        typed mock data (see <code className="rounded bg-muted px-1 py-0.5 text-xs">src/lib/api-client.ts</code>)
        until Epic 2&apos;s HTTP API exists to replace it.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {DESTINATIONS.map((d) => (
          <Link key={d.href} href={d.href}>
            <Card className="h-full transition-colors hover:border-primary">
              <CardHeader>
                <CardTitle>{d.title}</CardTitle>
                <CardDescription>{d.description}</CardDescription>
              </CardHeader>
              <CardContent />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
