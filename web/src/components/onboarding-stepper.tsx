import { cn } from "@/lib/utils";

type Step = { label: string; description: string };

const STEPS: Step[] = [
  { label: "Personal details", description: "Who you are and how to reach you" },
  { label: "Documents", description: "Certificate IV, police check, PI insurance and more" },
  { label: "Identity verification", description: "A quick check via Sumsub" },
  { label: "Business affiliation", description: "Join or create your broking business" },
  { label: "Review", description: "We'll confirm your profile is ready to share" },
];

/**
 * ONB-009 ("see exactly what is outstanding and why") starts here — even before
 * Documents/Identity/Business are built (later epics), showing the whole journey up
 * front is what keeps a multi-session onboarding flow from feeling like a black box.
 * Section 1.1 is blunt about why this matters: broker adoption fails on friction, and
 * not knowing how much is left is a form of friction even when the current step
 * itself is easy.
 */
export function OnboardingStepper({ currentIndex }: { currentIndex: number }) {
  return (
    <ol className="space-y-4">
      {STEPS.map((step, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <li key={step.label} className="flex gap-3">
            <div
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                state === "done" && "bg-status-success-bg text-status-success-fg",
                state === "current" && "bg-primary text-primary-foreground",
                state === "upcoming" && "bg-muted text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {state === "done" ? "✓" : i + 1}
            </div>
            <div>
              <p
                className={cn(
                  "text-sm font-medium",
                  state === "upcoming" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
