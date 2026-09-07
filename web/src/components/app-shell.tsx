import Link from "next/link";

/**
 * Shared chrome across every demo screen in this scaffold. In the real product,
 * brokers and reviewers are different audiences with different navigation (Section
 * 6.0 distinguishes the two throughout) and would very likely get separate layouts
 * under route groups — e.g. app/(broker)/layout.tsx vs app/(reviewer)/layout.tsx.
 * One shared header is a deliberate simplification for this foundations scaffold so
 * every screen is reachable from one place; split it once Epic 3 (broker) and Epic 10
 * (reviewer workbench) are real enough to diverge.
 */
const NAV = [
  { href: "/design-system", label: "Design system" },
  { href: "/register", label: "Broker registration" },
  { href: "/login", label: "Sign in" },
  { href: "/profile", label: "My profile" },
  { href: "/business", label: "My business" },
  { href: "/relationships", label: "My relationships" },
  { href: "/client-login", label: "Lender sign in" },
  { href: "/client/relationships", label: "Broker panel" },
  { href: "/reviewer/queue", label: "Reviewer queue" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight text-foreground">
            Thriski
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="hover:text-foreground">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
