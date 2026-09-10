"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "./brand-mark";
import {
  Bell,
  Building2,
  ClipboardCheck,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  LogIn,
  Palette,
  Settings,
  ShieldCheck,
  UserCircle,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; items: NavItem[] };

// Shared chrome across every demo screen in this scaffold. In the real product,
// brokers and reviewers are different audiences with different navigation (Section
// 6.0 distinguishes the two throughout) and would very likely get separate layouts
// under route groups — e.g. app/(broker)/layout.tsx vs app/(reviewer)/layout.tsx.
// One shared sidebar is a deliberate simplification for this foundations scaffold so
// every screen is reachable from one place; the grouping below at least keeps the
// broker and lender worlds visually separate even though they share one shell.
const NAV_GROUPS: NavGroup[] = [
  {
    label: "Broker",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/profile", label: "My profile", icon: UserCircle },
      { href: "/tasks", label: "Outstanding tasks", icon: ListChecks },
      { href: "/business", label: "My business", icon: Building2 },
      { href: "/relationships", label: "My relationships", icon: Link2 },
      { href: "/accreditations", label: "My accreditations", icon: ShieldCheck },
    ],
  },
  {
    label: "Lender",
    items: [
      { href: "/client/relationships", label: "Broker panel", icon: Users },
      { href: "/client/queue", label: "Review queue", icon: ClipboardCheck },
      { href: "/client/settings", label: "Organisation settings", icon: Settings },
    ],
  },
];

const GET_STARTED: NavItem[] = [
  { href: "/register", label: "Broker registration", icon: UserPlus },
  { href: "/login", label: "Broker sign in", icon: LogIn },
  { href: "/client-login", label: "Lender sign in", icon: KeyRound },
];

const AUTH_ROUTES = new Set(["/login", "/register", "/client-login"]);

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center">
      <BrandMark className="text-lg" />
    </Link>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={
        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors " +
        (active
          ? "bg-accent font-medium text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground")
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      {item.label}
    </Link>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 flex w-64 flex-col border-r border-border bg-card">
      <div className="flex h-16 shrink-0 items-center border-b border-border px-5">
        <Brand />
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
              ))}
            </div>
          </div>
        ))}

        <div>
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            Notifications
          </p>
          <NavLink
            item={{ href: "/notifications", label: "Notifications", icon: Bell }}
            active={isActive(pathname, "/notifications")}
          />
        </div>

        <div className="mt-auto">
          <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            Get started
          </p>
          <div className="flex flex-col gap-0.5">
            {GET_STARTED.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
            ))}
          </div>
        </div>
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <NavLink
          item={{ href: "/design-system", label: "Design system", icon: Palette }}
          active={isActive(pathname, "/design-system")}
        />
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (AUTH_ROUTES.has(pathname)) {
    return (
      <div className="flex min-h-full flex-col bg-background">
        <div className="flex h-16 shrink-0 items-center px-6">
          <Brand />
        </div>
        <main className="flex flex-1 items-center justify-center px-4 pb-16">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <Sidebar pathname={pathname} />
      <main className="min-h-full pl-64">{children}</main>
    </div>
  );
}
