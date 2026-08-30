import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { allStatusesFor, STATUS_DOMAINS, type StatusDomain } from "@/lib/status";

const CORE_TOKENS: Array<{ name: string; bgClass: string; fgClass: string }> = [
  { name: "background / foreground", bgClass: "bg-background", fgClass: "text-foreground" },
  { name: "card / card-foreground", bgClass: "bg-card", fgClass: "text-card-foreground" },
  { name: "primary / primary-foreground", bgClass: "bg-primary", fgClass: "text-primary-foreground" },
  { name: "secondary / secondary-foreground", bgClass: "bg-secondary", fgClass: "text-secondary-foreground" },
  { name: "muted / muted-foreground", bgClass: "bg-muted", fgClass: "text-muted-foreground" },
  { name: "destructive / destructive-foreground", bgClass: "bg-destructive", fgClass: "text-destructive-foreground" },
];

const DOMAIN_LABELS: Record<StatusDomain, string> = {
  profile: "Broker profile — Section 8.1",
  business: "Broker business — Section 8.2",
  accreditation: "Accreditation — Section 8.3 (Epic 10, not yet built)",
  relationship: "Relationship — migration 0004",
  monitoring: "Monitoring item — Section 8.5 (Release 2, not yet built)",
};

export default function DesignSystemPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Design system</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          The rendered source of truth for src/app/globals.css and src/lib/status.ts. If a screen
          anywhere in the product uses a colour that isn&apos;t on this page, that&apos;s a bug in the
          screen, not a gap in this page.
        </p>
      </div>

      <section>
        <h2 className="text-base font-semibold text-foreground">Core tokens</h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {CORE_TOKENS.map((t) => (
            <div key={t.name} className={`rounded-lg border border-border p-4 ${t.bgClass}`}>
              <p className={`text-sm font-medium ${t.fgClass}`}>{t.name}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground">Status meaning — five colours, never more</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Every lifecycle status in the platform — across five independent status planes (Section 5.3) —
          reduces to one of these five meanings. See src/lib/status.ts for the full mapping.
        </p>
        <div className="mt-4 space-y-8">
          {STATUS_DOMAINS.map((domain) => (
            <div key={domain}>
              <h3 className="text-sm font-medium text-foreground">{DOMAIN_LABELS[domain]}</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {allStatusesFor(domain).map((s) => (
                  <StatusBadge key={s.value} domain={domain} value={s.value} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground">Buttons</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground">Badges (non-status)</h2>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Badge>2 outstanding</Badge>
          <Badge variant="outline">Manual check</Badge>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-foreground">Type scale</h2>
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>text-2xl / font-semibold — page titles</CardTitle>
            <CardDescription>text-sm / text-muted-foreground — supporting copy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-base text-foreground">text-base — body copy</p>
            <p className="text-sm text-foreground">text-sm — dense UI (tables, forms)</p>
            <p className="text-xs text-muted-foreground">text-xs — captions, hints, timestamps</p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
