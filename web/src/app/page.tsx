import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DESTINATIONS = [
  {
    href: "/accreditations",
    title: "My accreditations",
    description: "Request accreditation with a lender and track it through review, training and activation.",
  },
  {
    href: "/client/queue",
    title: "Review queue",
    description: "The lender review workbench: dense, filterable, evidence-first.",
  },
  {
    href: "/design-system",
    title: "Design system",
    description: "Every colour token and status mapping in one reference page.",
  },
] as const;

export default function Home() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Welcome to brok3r</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Broker onboarding, accreditation and ongoing monitoring, in one place. Pick up where you left off,
        or jump into one of the screens below.
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
