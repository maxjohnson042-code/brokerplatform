import { cn } from "@/lib/utils";

export type Tab = { id: string; label: string };

// Minimal, presentational tab strip — no context/compound-component machinery. The
// parent owns activeId state and conditionally renders panel content itself; this
// component only renders the strip. Kept deliberately simple until a second real use
// justifies more (see profile-view.tsx for the first).
export function TabBar({ tabs, activeId, onChange }: { tabs: Tab[]; activeId: string; onChange: (id: string) => void }) {
  return (
    <div className="border-b border-border">
      <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Sections">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors",
                active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
