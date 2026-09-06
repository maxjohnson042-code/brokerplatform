# Thriski — Information Architecture and Onboarding UX

*Product/UX thinking, not a spec — read alongside the Master Requirements and Architecture Document v2.0 and the Release 1 Backlog. Written 30 Aug 2026 in response to "what areas should the web app be, and what's the most optimal broker onboarding experience." Extended 31 Aug 2026 with a critical assessment against current KYC/KYB onboarding practice — see the addendum at the end.*

## Three audiences, three experiences, one design system

The domain model already implies this split (broker / client organisation / platform operations are different actors with almost no UI overlap), so the IA should say so explicitly rather than building one app with role-based visibility toggles.

**Broker side** (self-service portal — this is where Section 1.1's "adoption problem, not a revenue one" lives):
- Onboarding / profile-build flow (currently `/register`)
- Home screen — should double as the outstanding-items view (ONB-009), not a separate report
- Profile — viewable and editable at any time (PRF-004)
- Documents
- Relationships — which lenders/aggregators/associations they're linked to, and what each can see (PRF-005)
- Their business, if they're a principal
- Notifications
- Account settings (password, MFA when built)

**Client side** (lender reviewers today; aggregator/association later):
- Review queue — built (`/reviewer/queue`)
- Broker/accreditation detail — built (`/reviewer/brokers/[id]`)
- Client admin — user provisioning and roles (AUTH-008), not yet built
- Panel-level dashboard — not in the Release 1 backlog, but it's its own epic in the original BRD and NFR-PER-2 explicitly sizes for "thousands of brokers." Worth planning for even if it lands after Release 1, since the workbench alone won't scale as the primary daily view once a panel is more than a handful of names.

**Platform side** (Thriski operations, internal-only):
- Client organisation onboarding and ruleset configuration (W7) — correctly scoped in the Release 1 backlog as a plain internal tool, not a design priority yet.

## The optimal broker onboarding experience

Two constraints from the master document make this a specific design problem, not a generic one:

- **Section 1.1**: brokers aren't paying, so they won't tolerate friction — profile build, document upload and monitoring reminders have to be genuinely easy or supply never materialises.
- **NFR-PER-1**: applicant experience is mobile-first; document capture by phone camera.

Honest gap check: what's built so far (`/register`) is responsive in the basic sense (grids collapse below `sm:`), but nothing yet actually targets a phone as the primary device. That's a real gap against an explicit requirement, not a nice-to-have to defer indefinitely.

Recommendations, in rough priority order:

1. **Lead with the document, not the form.** Section 6.1 already specifies extracted document data gets compared against entered values — invert the usual order. Let the broker photograph their licence/CRN/PI certificate first, pre-fill from extraction (Sumsub or otherwise), and have them confirm/correct rather than type from scratch on a phone keyboard.

2. **Make the stepper honest about real dependencies, not just visual progress.** Let brokers jump to whatever section they have ready, and hard-block only where the domain model actually requires order — e.g. a broker can reach Verified with no business (Section 6.1's sequencing rule) but can't reach accreditation without one. The UI's gating should mirror that exact boundary, not a generic "step 3 of 7."

3. **One branching question, not two forms.** BUS-013's sole-trader combined journey is a real UX opportunity: ask "Do you operate under your own business, or someone else's?" early, and derive the business record from what they already typed if it's their own. Getting this wrong is how "combined journey" quietly becomes two forms asking the same six fields.

4. **Business affiliation should search, not ask.** W2's "no re-keying of anything already in the profile" extends to "no re-keying of anything already on the platform." Affiliating with an existing verified business should be a search-by-ABN-or-name-and-request-to-join flow, not re-entering entity details a colleague already provided.

5. **Consent has to be shown, not just checked.** Section 2.2 requires the broker see clearly what a client will be able to see before consenting. Reuse the evidence-disclosure pattern already built for reviewers (Section 2.4), shown from the broker's side, so "here's exactly what Westpac will see" is a real preview rather than a checkbox wall.

6. **Autosave everywhere; draft is the default state, not a mode.** The register form's `getValues()`-not-`handleSubmit()` draft pattern is the right foundation — extend it so a broker never has to think about saving, because there's no unsaved state to lose.

7. **Set honest time expectations, and never go quiet after submission.** Given cold-start economics (Section 1.2) mean lender-1's brokers are the only proof this is better than the old process, state the real time cost up front ("about 15 minutes with documents ready"). After submission, show status against the actual four-plane model — profile, business, this accreditation, monitoring (Section 8) — rather than collapsing everything to one "pending" badge, since that's the entire point of the domain model this is built on.

## Open question this raises

Mobile-first document capture (point 1) is a materially different build than what's scaffolded — it likely wants native camera input handling and probably a different upload component than the current form-first pattern. Worth deciding whether this is folded into Epic 3 (broker profile build) as originally sequenced, or pulled forward as its own small spike before the rest of the onboarding UI is built out further, so later screens aren't built against the wrong interaction model.

---

## Addendum, 31 Aug 2026 — critical assessment: is this "market-leading," or just compliant?

The seven recommendations above describe a good onboarding form. They don't, on their own, describe a onboarding experience that would read as *ahead* of what brokers already encounter elsewhere — most brokers have been through at least one modern KYC flow (a fintech, a bank's own onboarding, a mortgage aggregator's CRM) and the bar those set is higher than "the fields are logically ordered and it saves drafts." This addendum is the harder pass: what would a broker, reviewer or engineer familiar with current KYC/KYB practice notice was *missing*, not just unfinished.

Grounded in current industry practice (KYCAID's drop-off-reduction guidance, Binderr's KYB benchmarks) rather than invention, six gaps stood out as real and specific enough to act on. All are now reflected in the master requirements document (Section 6.1a) as proposed additions — not settled, per this document's OQ-11 practice, but concrete enough to build against once confirmed:

1. **Business data should be looked up, not typed.** The single biggest gap. KYB onboarding that makes someone type their own entity's registered name, address and GST status — data a government register already holds and can return in under a second by ABN/ACN — reads as dated the moment a broker compares it to almost any modern business-facing signup. This is now ONB-014 (individual broker's business lookup) and BUS-024 (search when creating/affiliating a business), both feeding a shared lookup service (Release 1 Backlog Epics 3 and 4). Australia's ABN Lookup web service is the obvious default — free, public, no commercial negotiation — but that's a build-time decision, not a foregone one (OQ-45).

2. **Document capture doesn't yet exploit what the ID&V provider already gives away for free.** Section 6.1a §1 (document-first capture, ONB-013) was already identified in the original pass above as point 1. The addition here is narrower and easier to miss: Sumsub's SDK, once integrated for Epic 6, very likely already includes passive liveness, auto-capture/edge detection and NFC chip reads as configuration flags, not new engineering. Building a plainer custom capture UI instead and leaving that capability unused would be building *worse* UX for *more* effort than the default path — it's a check to make during the Epic 6 adapter build, not a separate initiative. This is IDV-015.

3. **No cross-device handoff.** NFR-PER-1 already commits to mobile-first document capture, but says nothing about the (very common) case of a broker starting on a desktop — comfortable for typing licence numbers and personal details — and needing a phone only for the camera step. Without a handoff, that broker either abandons the desktop session and starts over on mobile, or photographs documents awkwardly at a desk. A short-lived link or code that continues the same session on a second device is standard in modern KYC flows and directly serves brokers who split their onboarding across devices rather than completing it in one sitting. This is ONB-015.

4. **No contextual priming before sensitive asks.** Requesting a date of birth, a police certificate or credit-report consent without a one-line "why" ahead of the request is a known drop-off point — people hesitate over an unexplained ask for sensitive information more than an explained one, even when the underlying requirement doesn't change. This is a copy and sequencing change, not new functionality, which makes it cheap relative to its likely effect on completion. This is ONB-016.

5. **Nothing brings an abandoned broker back.** The draft/resume mechanism (ONB-008) assumes the broker chooses to return. Section 1.1's own framing — friction is an adoption risk because a broker who abandons never becomes supply — implies the platform should also prompt the return, the way most consumer onboarding funnels do (an email after a day or two showing what's left, not a generic "come back"). This is distinct from Section 11's monitoring reminders, which only apply post-accreditation; nothing currently addresses the pre-submission funnel. This is ONB-017.

6. **Accessibility isn't specified anywhere.** NFR-PER-1 mandates mobile-first; nothing in Section 16 sets an accessibility bar for the same applicant-facing flow. Given the "adoption problem, not a revenue one" framing applies to every broker, not just the median one, an inaccessible flow is a supply-side risk in the same category as a slow or confusing one — not a separate compliance-only concern to defer. This is now NFR-PER-3, proposed at WCAG 2.2 AA, with the commitment/timeline decision tracked at OQ-46.

Two smaller items were added alongside these because they surfaced naturally during the same pass, though neither is as consequential as the six above: DOC-009 (basic client-side upload quality gating — reject an obviously blurry or blank photo before it reaches a reviewer, for document types the ID&V SDK doesn't already gate) and REV-013 (optionally showing the broker which named reviewer or relationship manager is handling their application — Could-have, and genuinely optional per lender per OQ-47).

**What was deliberately not added.** A few things that appear on generic "market-leading onboarding" checklists were considered and left out, because they don't fit this platform's actual shape: a chatbot/conversational intake (Section 27 already rules out generic document-management-style build sprawl, and a broker onboarding a licensed financial-services identity is not the same use case as casual consumer sign-up); gamification or progress-completion scoring beyond the honest stepper already recommended above (Section 1.1's brokers are professionals completing a compliance obligation, not a game); and a fully white-labelled per-lender onboarding skin (Section 4's shared-profile value proposition depends on the broker experiencing this as *one* platform they build a profile on once, not a different-looking form per lender — a themed skin per client would undercut the "build once, share with many" pitch that is the product's actual differentiator).

**Net assessment.** The original seven-point recommendation set was necessary but insufficient — it would have shipped a well-built, compliant, somewhat generic form. The six gaps above are what separate that from an experience a broker would actually notice as better than the paper process (or a competing platform) it replaces, and they're now traceable requirement IDs (ONB-013–017, BUS-024, IDV-015, DOC-009, REV-013, NFR-PER-3) rather than a one-off opinion. All are proposed, not committed — OQ-45, OQ-46 and OQ-47 in the master document are exactly the confirmations needed before Release 1 planning treats them as scope rather than aspiration.
