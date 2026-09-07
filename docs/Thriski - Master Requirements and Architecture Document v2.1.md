# Thriski — Master Requirements and Architecture Document

**Product:** Multi-tenant broker onboarding, accreditation and ongoing monitoring platform **Version:** 2.0 — canonical project document **Supersedes:** BRD v1.5 and all earlier versions; Architecture and Sequencing v1.0 (both now consolidated here) **Status:** Current. This is the single authoritative reference for the Thriski build.

  

**Structure**

  

  - **Part A — Business requirements** (Sections 1–17): product model, scope, actors, domain model, workflows, functional and non-functional requirements, data and document requirements, open questions.
  - **Part B — Technical architecture and delivery** (Sections 18–28): system shape, data architecture, orchestration, integration posture, release sequencing.
  - **Annexes**: worked example and source documents.

  

Part A defines what the platform must do and is owned by product and compliance. Part B defines how it is built and is owned by engineering. They change at different rates — when they conflict, Part A governs intent and Part B governs implementation.

  

# Part A — Business requirements

## 1\. Product vision

Today a broker who works with eight lenders is accredited eight times. Each lender asks for broadly the same documents, runs broadly the same checks, and stores the result in its own systems. When the broker's professional indemnity cover lapses or they change aggregator, every one of those eight relationships is silently out of date until someone notices.

  

Thriski inverts this. **The broker onboards once and owns their profile.** Lenders, aggregators and associations connect to that profile through an explicit relationship, see only the brokers who have linked to them, and receive continuous assurance that the underlying information is still true.

  

Three capabilities define the product:

  

1.  **Onboard once** — a single verified broker profile, reusable across every institution the broker works with.
2.  **Accredit per relationship** — each institution applies its own requirements and makes its own decision against the shared profile.
3.  **Stay current** — expiring credentials, licence status changes, association standing and adverse events are monitored continuously and propagated to every linked institution.

  

Westpac's manual accreditation, transfer and monitoring procedures are the reference implementation used to derive requirements in this document. They are **illustrative of what a lender needs, not the definition of the product**. Westpac-specific detail is retained in Annex A as a worked example.

### 1.1 Commercial model

**Lenders pay.** Charging is based on the number of brokers, with the fee and precise basis still to be set. Brokers, aggregators and associations are not revenue sources.

  

Two consequences for the build:

  

**The broker experience is an adoption problem, not a revenue one.** Brokers are not paying to avoid friction, so they will not tolerate it. Profile build, document upload and monitoring reminders have to be genuinely easy or supply never materialises and the lender's panel stays empty.

  

**The platform must meter from day one.** Every billable event — broker linked, accredited, actively monitored — needs to emit a usage record as it happens (Section 12.19). Retrofitting billing telemetry across an audit-bearing system is expensive and error-prone.

### 1.2 The cold-start problem

Lender one pays for a network that does not yet exist. At that point every broker onboards from scratch, no check is reusable, and the product resembles a better-organised version of what the lender already does. Reuse economics only begin to bite from the second or third lender.

  

**Ongoing monitoring is what is valuable to lender one on day one.** It requires no network effect: continuous currency assurance over a panel is worth paying for even if that lender is the only client on the platform. This is the argument for treating monitoring as MVP rather than fast-follow, and it should shape both the build sequence and the sales narrative.

  

## 2\. Platform model

### 2.1 Tenancy

|  |  |
| :-: | :-: |
| \*\*Concept\*\* | \*\*Definition\*\* |
| \*\*Broker profile\*\* | The individual. Owned by the broker. Identity, individual credentials, association memberships, individual documents and history. Exists independently of any institution. |
| \*\*Broking business\*\* | The entity the broker operates through. Onboarded and verified in its own right, with its own registration, principals, PI cover, licensing and status. One business, many brokers. |
| \*\*Client organisation\*\* | A tenant: a \*\*Lender\*\*, an \*\*Aggregator\*\*, or an \*\*Association\*\*. Has its own users, configuration and requirement ruleset. |
| \*\*Relationship\*\* | An explicit, consented link between one broker and one client organisation. Typed (lender panel, aggregator membership, association membership) and independently statused. |
| \*\*Accreditation\*\* | A four-party record — lender, individual broker, broking business, aggregator / ACL holder — carrying the lender-issued broker ID, classification and product scope. Granted to the individual but dependent on all four parties. See Section 5.2. |
| \*\*Authority chain\*\* | Aggregator / ACL holder → broking business → individual broker. Every link must be valid for the broker to act. See Section 5.1. |

  

**The relationship is the visibility boundary.** A client organisation can see a broker's profile only where an active relationship exists. No client can browse, search or discover brokers they are not linked to. This is a hard architectural constraint, not a UI rule — enforce it at the data access layer.

### 2.2 Data ownership and consent

  - The broker owns their profile data and controls which client organisations it is shared with.
  - Sharing is granted by the broker (requesting accreditation) or requested by a client and accepted by the broker.
  - **Sharing is at relationship level and is complete.** A lender with an active relationship sees the full profile: all data, all documents, and the **full underlying results and evidence** of every check performed — not a summary status. See Section 2.4.
  - Consent is therefore a single, informed, relationship-level decision. The broker must be shown clearly, before consenting, exactly what the client will be able to see.
  - Sharing scope varies by **client type**, not by field within a type:
      
      - **Lender** — full profile, documents, checks and evidence, plus aggregator and association context. Not other lenders' relationships.
      - **Aggregator** — everything, including which lenders the broker is accredited with. The aggregator holds or intermediates the licence and is accountable for the broker's licensing and training, so it sits above the lenders rather than alongside them.
      - **Association** — membership-related data only, pending confirmation (OQ-4).
  - Revoking a relationship revokes forward visibility. Historical records the client needed for its own compliance obligations are retained per Section 16 and OQ-9.

### 2.3 Why associations matter

Associations (MFAA, FBAA, CAFBA, and AFCA as the external dispute resolution scheme) are not peripheral. They are:

  

  - **An authoritative source.** Membership currency, CPD compliance and disciplinary standing are facts only the association can confirm. Everyone else is reading a PDF certificate the broker uploaded.
  - **A monitoring signal.** Membership lapse, suspension or a disciplinary finding is precisely the kind of event lenders and aggregators need to hear about immediately.
  - **An onboarding channel.** A new broker joining an association is a natural entry point into the platform.
  - **A tenant in their own right.** Associations need to see their members' status and manage their own membership lifecycle.

  

Association integration is what makes ongoing monitoring credible rather than document-expiry bookkeeping.

### 2.4 Evidence visibility — a defining requirement

A lender relying on a check performed by or through Thriski must be able to see and retain **what it relied on**, not an assertion that someone else was satisfied.

  

This means every check surfaces to the linked client:

  

  - The **full result payload** from the source — the ID\&V provider's response, the register extract, the bureau report — not a derived pass/fail.
  - The **source and method**: which provider, which register, which query.
  - The **timestamp** of the check.
  - The **artefact** as returned, retained immutably.
  - The **decision history**: who at which organisation reviewed it, when, what they concluded and why.

  

"Verified: yes" is not an acceptable output anywhere in this system. A boolean is a conclusion; a lender relying on the check needs the basis for it, and needs to be able to produce that basis to a regulator or an internal auditor years later. This constraint shapes the storage model — see Sections 5, 12.6, 12.17 and NFR-AUD-\*.

### 2.5 Relationship context

A lender cannot form a compliance view from the broker's own documents alone. Two facts sit outside the profile and are decisive:

  

**Which aggregator the broker operates under.** Lender accreditation is typically held under a specific aggregator, and the lender relies on that aggregator to ensure licensing and training are maintained. A lender that cannot see the aggregator link — or does not learn when it changes — is relying on a party it cannot name.

  

**Which association the broker belongs to, and their standing.** Membership currency and disciplinary standing are compliance inputs, and the association is the authoritative source for both. A certificate the broker uploaded is weaker evidence than the association's own confirmation.

  

So a linked lender sees, for each of its brokers:

  

  - The aggregator relationship: which aggregator, status, effective dates, and confirmation by that aggregator that the broker is on its panel.
  - The association relationship(s): which association, membership number, current status and standing, and whether it is association-confirmed or certificate-only.
  - The history of both — including prior aggregators, since a transfer is material to a lender's view.
  - Notification when either changes.

  

**What a lender does not see:** which other lenders the broker is accredited with. That is commercially sensitive to both the broker and the other lenders, and is not needed to form a compliance view. Default this off. If a lender argues it needs the concurrent-accreditation check the current manual process performs, treat that as a specific, separately-consented exception rather than opening the graph (OQ-19).

### 2.6 Compliance regime — the consolidated list

Lenders and aggregators each keep their own risk registers and grey lists today. They are fragmented, informal, and invisible to everyone outside the organisation that holds them. Consolidating them onto the platform is genuinely valuable: it is the single clearest thing Thriski can do that no individual participant can do for itself.

  

It is also the highest-risk feature in this document, and the risk is different in kind from the rest. Everything else in the platform records facts from external sources. This feature creates a shared record, hosted by Thriski, in which competitors name brokers — and being named can end a career.

  

**The design that makes this workable is a two-tier split.**

#### Black list — external determinations only

Entries derive from a determination made by a body whose function is to make it: a regulator (banned and disqualified, licence cancelled or suspended), a court, an association (expulsion, suspension, disciplinary finding), or an insolvency authority. No lender or aggregator can create a black list entry by assertion.

  

These are verifiable facts, not opinions. They warrant automatic action: on a confirmed match the broker is flagged Blacklisted and removed from every lender on the platform.

#### Grey list — contributor-asserted concerns

Entries are created by a lender or aggregator recording a concern about a broker. This is the consolidation of what participants already hold privately.

  

Because these are assertions rather than determinations, they carry materially different rules:

  

1.  **Advisory only.** A grey listing never triggers automatic removal. It notifies; each lender decides its own response. The platform takes no action on its own.
2.  **Evidence and category are mandatory.** A bare name is not an entry.
3.  **The contributor is identified to the platform**, and accountable for the entry. Whether the contributor is visible to other lenders is a governance decision (OQ-41).
4.  **The broker is notified that they have been listed**, sees the category and substance, and can record a response that travels with the entry. Listing someone secretly is the version of this feature that is indefensible.
5.  **Entries expire** on a defined period by category, and can be withdrawn by the contributor.
6.  **Entries are presented as what they are** — an unadjudicated concern raised by a market participant, not a finding. The interface wording matters as much as the data model here.
7.  **Thriski does not adjudicate.** It hosts, evidences and expires. It does not determine whether a grey entry is true.

  

**The risk that remains, stated plainly.** A platform-hosted list where competing lenders name brokers, and all of them act on it, is closer to a collective boycott than the previous design was, and Thriski is the publisher for defamation purposes. The controls above — advisory status, mandatory evidence, broker notification and right of reply, expiry, no platform adjudication — are what make it defensible. They are not optional refinements; removing any one of them materially changes the risk. This needs a legal view and a written governance framework covering who may contribute, on what basis, and how a broker challenges an entry (OQ-41 to OQ-44). It should not be the first thing built.

  

**Sequencing recommendation.** Black list screening is low-risk and immediately valuable — build it first. The grey list needs the governance framework agreed before it ships, and would sit better in a second release once the platform has participants and the framework has been tested with them.

### 2.7 Risk assessment — two separate things

A single shared risk score fed by lenders' subjective ratings would defeat Section 2.6 — it would reintroduce, without any of the controls, exactly the peer-reporting mechanism that section deliberately avoids. A private flag that silently raises a number every lender sees is worse than a published finding: no category, no evidence, no right of reply, nothing to appeal. The broker is quietly declined everywhere and never learns why. It is also the version of the feature that sits closest to a coordinated blacklist under competition law.

  

The platform therefore separates private judgement from shared fact.

  

**Private lender assessment.** Watch lists, internal ratings and recorded concerns. Visible only to the lender that created them. They drive that lender's own review intensity, monitoring cadence and panel management. Most lenders keep this informally today; giving it a proper home is a genuine feature.

  

**Shared conduct risk indicator.** Visible to all linked lenders. Fed **only** by inputs that are either externally determined or objectively measurable — never by another lender's opinion.

  

**The escalation path is the join between them.** A private concern becomes visible to others only by being promoted to a grey list entry, which requires evidence, a category, and notification to the broker with a right of reply (Section 12.19). It never reaches the risk indicator (RSK-002a). The watch list stays useful; it does not become a silent back channel.

  

**Shared indicator inputs — externally determined:**

  

  - Industry blacklist listing (overriding — a listed broker is removed, not scored)
  - Association disciplinary outcomes and standing
  - Regulator action: licence conditions, variations, suspensions, banned and disqualified
  - Screening exceptions and how they were resolved

  

**Shared indicator inputs — objectively measurable:**

  

  - Licence conditions, variations, suspensions
  - Verification failure rate: income, employment or expenses found misstated
  - Documentation found falsified or altered
  - Early payment default rate
  - Applications withdrawn or declined for misrepresentation
  - Upheld responsible-lending complaints
  - Monitoring breaches and unresolved currency items
  - Attestation and information-request responsiveness
  - Aggregator transfer frequency

  

**Explicitly not an input: loan arrears and defaults generally.** These mostly reflect borrower circumstances, economic conditions and the lender's own credit decision. Brokers will contest attribution, correctly. Early payment default is the exception, because it does correlate with origination quality.

  

**Measurement rules for the objective inputs:**

  

  - All rates are benchmarked against a peer cohort — comparing a commercial broker's EPD rate to a residential broker's is noise.
  - No rate is used below a minimum volume threshold. One bad loan in three is a small sample, not a 33% failure rate.
  - Every input has a defined decay period. A finding from four years ago should not weigh as a finding from last month.

  

**Design constraints:**

  

1.  **Explainable to lenders.** Never a bare number — a lender sees the components, not just a value.
2.  **Not visible to brokers.** The calculated indicator and its weightings are withheld from the broker. Every *input* remains visible to them: substantiated findings have been through CMP with a right of reply, screening exceptions are already surfaced, monitoring breaches already generate notifications. So nothing hidden from the broker is new information about them — only the aggregation and weighting is withheld. This limits gaming and methodology disputes before the model has outcome data behind it. See OQ-32 for the access-request exposure this creates.
3.  **Informs, never decides.** The indicator supports triage, review intensity and monitoring cadence. It does not approve or decline. Automated decisions materially affecting a person's livelihood attract scrutiny the platform should not invite.
4.  **Versioned.** Scores are stored with their inputs and model version so a past decision can be reconstructed (AUD-005).
5.  **No protected attributes**, and active testing for indirect proxies — postcode and years-since-qualification are the usual offenders.
6.  **Feedback loop guarded.** High indicator → more scrutiny → more findings → higher indicator is a real failure mode. Monitor for it.
7.  **Called an indicator, not a score.** On day one there is no outcome data, so any weighting is judgement expressed as arithmetic. The naming should be honest about that.

## 3\. Scope

### 3.1 In scope

|  |  |
| :-: | :-: |
| \*\*Area\*\* | \*\*Description\*\* |
| Broker registration and profile build | Self-service capture of identity, individual credentials, association membership and documents |
| \*\*Broking business onboarding\*\* | The business as a first-class entity: registration, principals, PI cover, licensing, entity screening and its own monitoring |
| \*\*Authority chain validation\*\* | Licence holder, corporate credit representative arrangement and individual authorisation verified as a chain, at onboarding and on cadence |
| Identity verification and screening | ID\&V, register checks, adverse screening |
| Relationship management | Linking to lenders, aggregators and associations; consent; revocation |
| Accreditation | Per-client assessment, decisioning, training, activation |
| \*\*Ongoing monitoring\*\* | Credential expiry, licence status, association standing, periodic re-screening, attestation, change-of-circumstance reporting |
| \*\*Data currency\*\* | Broker-initiated updates, propagation to linked clients, material-change re-review |
| Change events | Aggregator transfer, licence change, adverse event, cessation |
| Client dashboards | Lender, aggregator and association views of their linked brokers |
| Configurable requirements | Per-client document, check and monitoring rulesets |
| \*\*Consolidated list\*\* | Platform-hosted black list (external determinations, automatic cross-lender removal) and grey list (contributor-asserted concerns, advisory only, with broker right of reply) |
| \*\*Conduct risk indicator\*\* | Shared indicator fed by externally determined and objectively measurable inputs, visible to lenders only |
| Notifications and audit | Full event history and evidence retention |

### 3.2 Out of scope for MVP

  - Aggregator or association **accreditation by a lender** (the entity-to-entity agreement process). Client organisations are onboarded to the platform administratively — see Section 6.7. The Westpac aggregator procedure in Annex A is retained because its check logic is reusable, not because the workflow is in scope.
  - Commission calculation, statements or payment. Commission schedules are reference documents surfaced in the onboarding pack.
  - Loan origination or any borrower-facing journey.
  - In-solution chat (Section 12.16, all Could-have).
  - Replacement of client-side systems of record — Thriski integrates with or hands off to them.

  

## 4\. Actors

### 4.1 Broker side

|  |  |
| :-: | :-: |
| \*\*Actor\*\* | \*\*Description\*\* |
| \*\*Broker\*\* | Individual credit representative or licensee. Owns the profile, initiates relationships, maintains currency |
| \*\*Broking business\*\* | The entity the broker operates through. Onboarded in its own right; holds PI cover, registration and, where applicable, the ACL |
| \*\*Business principal\*\* | Director, secretary, partner or trustee. Can register and complete onboarding for the business, confirms broker affiliations, and is a screening subject whether or not they are themselves a broker |
| \*\*Mentor\*\* | Named on a mentoring letter for brokers with under two years' experience |

### 4.2 Client organisation side

|  |  |  |
| :-: | :-: | :-: |
| \*\*Actor\*\* | \*\*Type\*\* | \*\*Primary need\*\* |
| \*\*Lender reviewer / administrator\*\* | Lender | Assess and accredit brokers onto the panel; evidence compliance |
| \*\*BDM / relationship manager\*\* | Lender | Sponsor brokers, interview, relay decisions, manage a territory or portfolio |
| \*\*Senior approver\*\* | Lender | Decide on exceptions and adverse findings |
| \*\*Escalation / committee\*\* | Lender | Decide disputed declines |
| \*\*Aggregator administrator\*\* | Aggregator | Manage the broker panel, confirm membership, support broker accreditation with lenders |
| \*\*Association administrator\*\* | Association | Confirm membership currency, CPD compliance and standing; manage members |
| \*\*Compliance officer\*\* | Any | Monitor currency across the panel, evidence obligations to a regulator |

### 4.3 Platform side

|  |  |
| :-: | :-: |
| \*\*Actor\*\* | \*\*Description\*\* |
| \*\*Thriski administrator\*\* | Platform operations: client onboarding, configuration, exception handling, support |
| \*\*Third-party services\*\* | ID\&V provider, register sources, screening bureaux, police check vendor, e-signature |

  

## 5\. Domain model

### 5.1 The authority chain

An ABN does not confer authority to conduct regulated credit activity. Authority flows down a chain:

  

Aggregator / ACL holder

  

        │   (broking business is a corporate credit representative

  

        │    of the licence holder, or holds its own ACL)

  

        ▼

  

   Broking business

  

        │   (individual brokers operate under that arrangement)

  

        ▼

  

  Individual broker

  

The ACL holder is **commonly** the aggregator, but not always — the broking business may hold its own licence. Model "ACL holder" as a role that can be filled by the aggregator, the business itself, or a third-party licensee. Do not assume aggregator and licence holder are the same party.

  

**Every link in the chain must be valid for the broker to act.** If the licence is suspended, if the business ceases to be a credit representative of that licensee, or if the broker ceases to operate under the business, the broker's authority fails — regardless of the broker's own credentials being current. Verification and monitoring must therefore validate the **whole chain**, not just the broker's credit representative number. A broker with a current CRN under a business whose corporate credit representative status has been withdrawn is not authorised, and nothing in the individual's own record shows it.

### 5.2 Accreditation as a four-party relationship

Lender accreditation is granted to the **individual broker**, who receives a lender-issued broker or accreditation ID. But it is not standalone. It is issued in the context of, and depends on, the broker's business, their aggregator / ACL holder, and the credit representative arrangement.

  

Accreditation is therefore its own entity referencing four parties:

  

|  |  |
| :-: | :-: |
| \*\*Party\*\* | \*\*Role in the accreditation\*\* |
| \*\*Lender\*\* | Grants it, issues the ID, sets the requirements |
| \*\*Individual broker\*\* | Holds it; is the subject of the lender-issued ID |
| \*\*Broking business\*\* | The entity through which the broker operates and under which the accreditation was granted |
| \*\*Aggregator / ACL holder\*\* | The source of licensing authority and, typically, the party the lender relies on for ongoing licensing and training assurance |

  

**Consequence:** a change to any of the four parties may invalidate the accreditation. If the broker moves business or aggregator, the accreditation must be transferred, re-linked, or re-approved by the lender — the lender decides which, per its ruleset. This is precisely the transfer scenario in the source procedures, and modelling accreditation as a simple broker-to-lender link cannot express it.

### 5.3 Entities

Core entities an engineer should expect. Attribute detail in Section 13.

  

BrokerProfile  (the individual)

  

  ├─ Person (identity, contact, addresses)

  

  ├─ Credential (CRN | Cert IV | individual ACL | other)            \[0..n\]

  

  ├─ AssociationMembership (association, number, status, CPD)       \[0..n\]

  

  ├─ Document (individual-level: ID, police cert, resume, CPD)      \[0..n\]

  

  ├─ Attestation (type, statement, timestamp, version)              \[0..n\]

  

  ├─ BusinessAffiliation → BrokerBusiness (role, dates, current)    \[1..n\]

  

  └─ ProfileStatus

  

BrokerBusiness  (first-class entity, onboarded in its own right)

  

  ├─ entity type (company | sole trader | partnership | trust)

  

  ├─ registration (ABN/ACN, GST, trustee where applicable)

  

  ├─ addresses, contacts

  

  ├─ Principal (director | secretary | partner | trustee)           \[1..n\]

  

  │    └─ each is a screening subject in their own right

  

  ├─ Credential (business ACL, AFSL, AFSR)                          \[0..n\]

  

  ├─ Document (PI cover, registration, financials)                  \[0..n\]

  

  ├─ Check (entity and principal screening)                         \[0..n\]

  

  ├─ BusinessAffiliation → BrokerProfile                            \[1..n\]

  

  └─ BusinessStatus  (cascades to affiliated brokers)

  

ClientOrganisation (type: Lender | Aggregator | Association)

  

  ├─ ClientUser (role)                                              \[1..n\]

  

  ├─ RequirementRuleset (documents, checks, monitoring cadence)     \[1..n\]

  

  └─ ProductScope (e.g. Consumer, Commercial, Equipment Finance)    \[0..n\]

  

Relationship (BrokerProfile ↔ ClientOrganisation)

  

  ├─ type, status, consent record, effective dates

  

  └─ SharedDataScope

  

CreditRepresentativeArrangement

  

  ├─ licence holder (aggregator | broking business | third-party licensee)

  

  ├─ corporate credit representative → BrokerBusiness       \[0..1\]

  

  ├─ individual authorisation → BrokerProfile (CRN)         \[0..n\]

  

  ├─ status, effective dates

  

  └─ chain validity is derived from this, not from the broker alone

  

Accreditation  (first-class; references four parties)

  

  ├─ lender            → ClientOrganisation

  

  ├─ broker            → BrokerProfile

  

  ├─ business          → BrokerBusiness

  

  ├─ aggregator/ACL    → ClientOrganisation | BrokerBusiness

  

  ├─ product scope, classification (see 13.3)

  

  ├─ lender-issued accreditation / broker ID

  

  ├─ AccreditationStatus

  

  ├─ TrainingRecord                                         \[0..n\]

  

  ├─ Decision (actor, outcome, rationale, timestamp)        \[0..n\]

  

  └─ any party change → transfer | re-link | re-approve

  

Check (subject: profile | business | principal)

  

  ├─ type, source/provider, method, requested/completed timestamps

  

  ├─ Evidence (immutable)                                          \[1..n\]

  

  │    ├─ raw source payload as returned

  

  │    ├─ rendered artefact (PDF/screenshot) + hash

  

  │    ├─ captured\_at, retained\_until

  

  │    └─ never mutated; superseded only by a new Evidence record

  

  ├─ derived result (a view over Evidence, never a replacement)

  

  └─ Exception → Escalation → Resolution

  

BlacklistListing  (external determination, never created by Thriski)

  

  ├─ source (industry body), listed\_at, matched identifiers

  

  ├─ subject (broker | business | principal)

  

  ├─ confirmation state, delisted\_at

  

  └─ Evidence (source record as received, immutable)               \[1..n\]

  

LenderConcern  (private to one lender, never propagates)

  

  └─ client, subject, category, severity, evidence, referral record

  

PrivateAssessment (lender-scoped, never shared)

  

  └─ client, broker, type (watch list | rating), reason, severity, review date

  

RiskIndicator

  

  ├─ broker, value, model\_version, calculated\_at

  

  ├─ Component (input type, source reference, contribution, decay state)  \[1..n\]

  

  └─ immutable history; recalculated on input change

  

MeteringEvent (immutable)

  

  └─ client, broker, event type, timestamp, billing period

  

MonitoringItem

  

  ├─ subject reference (document | credential | membership | check)

  

  ├─ currency rule, next due date, status

  

  └─ MonitoringEvent (reminder, breach, resolution)

  

Event (immutable) — every state change, check, decision, notification, access

  

**Design point — four independent status planes.** A broker has one profile status. Their business has its own status. Each accreditation has its own status. Each monitoring item has its own status. These are independent and must not be collapsed into a single field.

  

A broker can be Active with Lender A, In review with Lender B and Suspended with Lender C, off one profile, while their business sits in Breach because its PI cover lapsed — which in turn constrains all three. Status resolution is a derived view over the four planes, not a stored value. See Section 8.

  

## 6\. Workflows

### 6.0 The broker / business relationship

A broker is an individual credit representative operating through a broker business. Both are onboarded; they are different subjects with different requirements.

  

|  |  |
| :-: | :-: |
| \*\*Sits at the individual\*\* | \*\*Sits at the business\*\* |
| Identity and ID\&V | Entity registration, ABN/ACN, GST |
| Credit representative authorisation | Australian Credit Licence where held by the entity |
| Industry qualification (Cert IV) | Professional indemnity cover |
| Association membership and CPD | Principals and directors |
| Police / criminal history | Entity solvency and adverse records |
| Individual conduct findings | Entity-level conduct findings |

  

**Cardinality.** One business has many brokers. A broker normally has one current business but may have more, and will have a history of previous ones. Model the affiliation as its own record with role and dates — not a foreign key on the broker.

  

**The business is onboarded once and reused.** Where five brokers operate under one business, the entity is verified once, its PI cover is held once, and its principals are screened once. Duplicating that per broker is both wasteful and a correctness problem: five copies of a PI certificate will drift out of sync, and the platform will not know which is authoritative.

  

**Cascade is the point.** PI cover, entity registration and solvency sit at the business. If the business's PI lapses or it enters administration, **every broker affiliated with it is affected simultaneously**, and every lender linked to any of them needs to know. A model that hangs business fields off the individual cannot express this.

  

**Sole traders.** Where the broker is the business, the platform must not make them enter the same information twice. Create the business record from the individual's details and present it as a single journey — the underlying entities stay separate, the experience does not.

### 6.1 W1 — Broker registration and profile build

1.  Broker registers (self-service, or invited by an aggregator, association or lender).
2.  Broker attests to the platform privacy policy and terms.
3.  Broker completes their **individual** profile: personal details, individual credentials, association membership. Business details are not captured here.
4.  Broker uploads documents. Data is extracted and compared with entered values; disparities are surfaced.
5.  Broker completes identity verification. ID\&V output is compared with entered identity data.
6.  Baseline screening runs (Section 7).
7.  Profile reaches Verified and becomes shareable.

  

4a. Broker affiliates with a broking business — either joining one already verified on the platform, or creating one and completing W6. Sole traders complete this inline as part of a single journey (BUS-013).

  

The broker can save and resume at any point. Nothing in W1 requires a relationship with a client organisation to exist.

  

**Sequencing rule.** A broker's profile can reach Verified without a business. It cannot reach accreditation with a lender without one, because the authority chain cannot be validated (ACR-010). Business affiliation is a precondition of W3, not of W1.

### 6.1a Onboarding experience — the market-leading bar

*Added 30 Aug 2026, following a critical assessment of the onboarding design against current KYC/KYB onboarding UX practice (see the companion "Information Architecture and Onboarding UX" document). This subsection sets a qualitative bar for W1 and W6 alongside the functional requirements in Sections 12.3–12.4; it does not replace them.*

Section 1.1 already establishes that onboarding friction is an adoption risk, not a satisfaction metric — a broker who abandons a draft never becomes supply for the lender's panel. Meeting the letter of ONB-\* and BUS-\* (the fields exist, the documents upload, drafts save) is necessary but not sufficient for that goal. Five specific mechanisms close the gap between "compliant" and "brokers actually finish this rather than the paper process it replaces":

1.  **Document-first capture, not form-first.** Where a required document is machine-readable (licence, CRN certificate, PI certificate of currency), the broker photographs or uploads it *before* being asked to type the corresponding fields, and the platform pre-fills from extraction for confirmation rather than blind entry. This is what W1 step 4's disparity-checking already implies but does not currently sequence — see ONB-013.
2.  **Business registry lookup, not manual entity entry.** Legal entity name, entity type, GST status and registered address are looked up from the national business register by ABN/ACN and offered for one-click confirmation, not typed. This also gives BUS-004's "affiliate with an existing verified business" a real search step instead of an unqualified claim. See ONB-014, BUS-024.
3.  **Cross-device continuation.** A broker who starts on a desktop (comfortable for typing personal and licensing details) can hand off document capture to their phone's camera — the device NFR-PER-1 actually assumes — via a short-lived link or code, without losing their session or re-authenticating from scratch. See ONB-015.
4.  **Contextual purpose statements at the point of ask**, particularly for sensitive fields (date of birth, police certificate, credit report consent): a one-line reason before the request, not after, following the same "why, what, how long" pattern used in industry-standard KYC flows. See ONB-016.
5.  **Abandoned-draft re-engagement.** A broker who stops mid-draft is reminded (email, and SMS where a mobile number is captured) after a configurable interval, showing what's left rather than re-stating the whole journey. This is distinct from Section 11's post-accreditation monitoring reminders — it covers the pre-submission funnel, which nothing in Sections 11 or 12 currently addresses. See ONB-017.

None of these change what data is collected or what the compliance regime requires; they change how the ask is sequenced and presented. They are proposed additions (OQ-45 tracks the open decisions) rather than settled requirements, consistent with this document's practice of flagging what is derived from a real source (BRD v0.2, the Westpac procedures) versus what is proposed and needs confirmation (OQ-11).

### 6.2 W2 — Establishing a relationship

Two directions:

  

**Broker-initiated:** broker selects the lenders, aggregator and associations they want to link to → consent recorded → request appears in that client's queue.

  

**Client-initiated:** client invites a broker (by email or association member list) → broker accepts and grants sharing → relationship created.

  

An aggregator relationship is normally a precondition for lender relationships, since lenders rely on the aggregator to confirm the broker's licensing and training. Authority flows from the licence holder down, so the chain must be in place before a lender accreditation is valid (Section 5.1). Where the business holds its own ACL, an aggregator relationship may exist for panel access only — see OQ-37.

### 6.3 W3 — Accreditation by a client organisation

1.  Client receives the request with the shared profile pre-populated. **No re-keying of anything already in the profile.**
2.  Client's requirement ruleset is evaluated: any document, check or attestation the client requires that the profile does not yet satisfy is raised as an outstanding item to the broker.
3.  Client-specific screening runs (some checks are client-specific and cannot be reused; see Section 7.3).
4.  Reviewer assesses. Exceptions route to a senior approver, who records a proceed/decline decision with mandatory rationale.
5.  Optional interview or relationship-manager recommendation is recorded.
6.  On approval: accreditation moves to Pending, downstream records are created in the client's systems, and required training is issued.
7.  Broker completes training within the client's deadline (Westpac's is 60 days). Platform tracks the deadline and reminds.
8.  On training completion, accreditation dates are set and the status moves to Active.
9.  Onboarding pack is issued: code of conduct, broker/introducer number, commission schedule, system access details.
10. Decline path: broker and any sponsoring relationship manager are notified with reasons. The broker may dispute and submit evidence, which routes to the client's escalation path.

### 6.4 W4 — Ongoing monitoring

This is a continuously running process, not a periodic project. Four mechanisms:

  

**(a) Expiry tracking.** Every document and credential with a validity period generates a monitoring item with a next-due date. Reminders are issued to the broker on a schedule (default 60 / 30 / 7 days, configurable). On expiry the item breaches, the profile flags, and every linked client is notified.

  

**(b) Source re-verification.** Licence and register status is re-checked on a cadence rather than trusted from onboarding: credit licence and representative status, banned and disqualified registers, insolvency and adverse records, and internal client lists. Cadence is configurable per client and per check type.

  

**(c) Association signals.** Membership currency, CPD compliance and disciplinary standing are pulled from or pushed by the association. A lapse, suspension or finding is a first-class monitoring event.

  

**(d) Broker attestation and change reporting.** The broker periodically re-attests that their profile is accurate and that no reportable change has occurred. Separately, the broker is obliged to report material changes within a defined window — licence revocation or variation, criminal charge or conviction, bankruptcy or insolvency, association disciplinary action, change of business entity, cessation of trading.

  

**Propagation rule.** When a monitoring event occurs, every client with an active relationship is notified. Whether it automatically suspends the accreditation, raises a review task or is informational is determined by the client's ruleset and event severity (OQ-5).

### 6.5 W5 — Change events

|  |  |
| :-: | :-: |
| \*\*Event\*\* | \*\*Handling\*\* |
| \*\*Broker moves between businesses\*\* | The affiliation is ended with dates retained and a new affiliation created. Business-level documents do not travel with the broker — the new business's PI cover, registration and licensing apply. Every accreditation held through the old business is flagged for transfer, re-link or re-approval (ACR-013) |
| \*\*Business changes identity\*\* | Covers restructure, re-registration and any change producing a new registered entity. Treated as a new business requiring full verification, with the prior entity retained in history. Every affiliated broker's accreditations are flagged. Where the change is amendment rather than a new entity (trading name, address, contacts), it is a profile update, not a new business |
| \*\*Aggregator transfer\*\* | Broker moves from Aggregator A to Aggregator B. Existing aggregator relationship is ended with a separation record confirming no adverse circumstances; new relationship is established. Lender relationships are re-evaluated, since lender accreditation is typically held under a specific aggregator. Prior broker/introducer IDs are looked up and reused or re-provisioned per the lender's rules |
| \*\*Licence or authorisation change\*\* | Re-verification against the register; affected accreditations flagged |
| \*\*Corporate credit representative withdrawn\*\* | The business ceases to be authorised under the licensee. Every affiliated broker loses authority immediately, regardless of their own current credentials. High-severity; all linked lenders notified |
| \*\*Adverse finding\*\* | Immediate notification to linked clients; each applies its own ruleset |
| \*\*Cessation\*\* | Broker deactivates the profile; all relationships closed with reason; retention rules apply |

  

Transfer is the highest-volume change event and the clearest illustration of the platform's value: today it is a manual paper process repeated with every lender; here it is one relationship change that propagates.

### 6.6 W6 — Broker business onboarding

1.  The business is created either by a principal registering it directly, by the first affiliating broker, or by an aggregator on behalf of its panel (OQ-34).
2.  Entity details are captured: type, registration, GST status, trustee where applicable, addresses, contacts.
3.  Principals are identified. **Every principal is a screening subject**, whether or not they are themselves a broker.
4.  Business-level documents are uploaded: PI cover, entity registration, licence where the entity holds one.
5.  Entity and principal screening runs: registration currency, GST, corporate status, solvency and external administration, adverse records, banned and disqualified, and prior or concurrent accreditations.
6.  The business reaches Verified and can be affiliated with brokers.
7.  Business-level monitoring begins immediately and runs independently of any individual broker (MON-005a to MON-005f).

  

Brokers affiliate to a verified business. A broker cannot complete accreditation with a lender while their business is unverified or in breach.

### 6.7 W7 — Client organisation onboarding

Administrative, performed by Thriski operations: create the organisation, verify it (entity registration, licensing where applicable, association legitimacy), configure its requirement ruleset, product scopes, user roles, monitoring cadence, branding and integrations, then provision users.

  

## 7\. Verification, screening and monitoring checks

### 7.1 Check catalogue

|  |  |  |  |  |
| :-: | :-: | :-: | :-: | :-: |
| \*\*Check\*\* | \*\*Subject\*\* | \*\*Source\*\* | \*\*Onboarding\*\* | \*\*Re-checked\*\* |
| Identity verification (primary and secondary ID) | Person | ID\&V provider | Y | On material identity change |
| Business registration: registered, current, GST status, trustee details where a trust | Business | National business register | Y | Periodic |
| Company status | Business | Corporate register | Y | Periodic |
| Credit licence status and currency | Person / business | Regulator professional register | Y | \*\*Periodic — high frequency\*\* |
| Credit representative authorisation and currency | Person | Regulator professional register | Y | \*\*Periodic — high frequency\*\* |
| \*\*Corporate credit representative status\*\* — the business's authorisation under the licence holder | Business | Regulator professional register / licensee | Y | \*\*Periodic — high frequency\*\* |
| \*\*Authority chain validity\*\* — licence + corporate credit representative + individual authorisation, evaluated together | Chain | Derived from the three above | Y | \*\*Every time any component is re-checked\*\* |
| Financial services licence / authorised representative | Business | Regulator professional register | Conditional | Periodic |
| Banned and disqualified — individuals and organisations | Person / business | Regulator register | Y | Periodic |
| Adverse records and directorships | Person / business | Credit bureau | Y | Periodic |
| Bankruptcy and insolvency | Person | Insolvency register / bureau | Y | Periodic |
| Association membership currency and standing | Person | Association | Y | \*\*Continuous or periodic\*\* |
| CPD compliance | Person | Association | N | Annual |
| Police / criminal history certificate | Person | Vendor or broker-supplied | Y | On validity expiry |
| \*\*Consolidated black list\*\* — regulator, court, association and insolvency determinations | Person / business / principal | External bodies, aggregated by Thriski | Y | \*\*Continuous or high-frequency\*\* |
| \*\*Consolidated grey list\*\* — contributor-asserted concerns, advisory only | Person / business | Lender and aggregator contributions | Y | Continuous |
| Client-specific internal lists (risk register, grey list, fraud, HR) | Person / business | Client's own systems | Client-specific | Per client ruleset |
| Prior or concurrent accreditation held elsewhere | Person | Platform + client registers | Y | On relationship change |

### 7.2 Exception handling

Any adverse result creates an exception task assigned to the relevant client's approver. The approver classifies it — proceed, proceed with condition, or decline — with mandatory rationale. Exceptions block progression until resolved. Every exception, decision and piece of evidence is retained immutably.

### 7.3 Reuse versus client-specific checks

A check performed for one client may be reusable by another if it is recent enough and the broker consented to sharing it. Reuse rules must be explicit per check type:

  

  - **Reusable within a validity window:** identity verification, business registration, licence status, association membership.
  - **Reusable with consent:** police certificate, credit report, bankruptcy.
  - **Never reusable:** any check against a client's own internal lists.

  

Getting this right is most of the platform's value proposition. Each check type needs a reusable, validity\_period and consent\_required configuration. See OQ-3.

  

**Reuse and monitoring interact — monitoring wins.** Where a check can be re-run against a live source (licence status, credit representative and corporate credit representative authorisation, business registration, banned and disqualified, insolvency, association membership), the monitoring cadence in Section 11 governs and reuse windows are irrelevant: the platform simply holds a current answer, continuously refreshed, that every linked client sees. Reuse windows apply only to **point-in-time checks that cannot be re-run cheaply or at all** — identity verification, police certificates, credit reports. Configure validity\_period only on that second group; for the first, configure a monitoring cadence instead. Setting both on the same check type is a configuration error the platform should reject.

  

**Reliance position.** The working assumption is that a lender may rely on identity verification and KYC performed through the platform rather than repeating it. This assumption underpins the product. Two things follow:

  

1.  It requires **legal confirmation before build commitment**, not after. If it fails, Thriski remains a shared workflow and document platform, but the reuse economics disappear and the commercial model needs revisiting.
2.  Reliance is only defensible if the relying party can see and retain the evidence, which is why Section 2.4 is a hard requirement rather than a nice-to-have. Reliance on an unexaminable conclusion is not reliance a lender can defend.

  

**Note on framing:** reliance rules differ between customer KYC and third-party/agent risk assessment. Broker onboarding sits closer to the latter — the Westpac material treats it via an agent ML/TF risk assessment rather than customer KYC. Make sure the legal question is asked about the right framework (OQ-3).

  

## 8\. Status models

### 8.1 Profile status

Draft → Submitted → In verification → Verified → Active

  

Plus: Incomplete (outstanding items), Attention required (a monitoring item has breached), Blacklisted (confirmed industry listing — see Section 8.6), Suspended, Deactivated (broker has ceased).

### 8.2 Business status

Draft → Submitted → In verification → Verified → Active

  

Plus: Incomplete, Attention required (a business monitoring item is due or overdue), Breach (a business monitoring item has breached — e.g. PI cover lapsed, entity deregistered), Suspended, Ceased.

  

**Cascade rule.** A business in Breach, Suspended or below Verified blocks new accreditation for every affiliated broker and raises a monitoring event on every existing accreditation (BUS-011, BUS-012). The broker's own profile status is unchanged — the constraint comes from the business plane, not the individual one.

### 8.3 Accreditation status (per accreditation record — see Section 5.2)

Requested → In review → Checks in progress → Approved → Pending (downstream record created, training issued) → Active

  

Plus: Information required, Exception — escalated, Declined, Disputed, Committee review, Conditionally active, Under review (triggered by a monitoring event), Suspended, Lapsed (training or currency deadline missed), Withdrawn, Ended.

  

Party-change state, arising when any of the four parties changes (ACR-013): Party changed — pending lender re-acceptance. The accreditation remains in force pending the lender's re-acceptance; it is flagged, not suspended.

  

Blacklist state: Suspended — blacklisted, set automatically and cleared only by lender reinstatement after delisting (BLK-010, BLK-011).

### 8.4 Authority chain status (derived, not stored)

Valid | Broken — licence | Broken — corporate credit representative | Broken — individual authorisation | Unverified

  

Derived from the credit representative arrangement, not from any single party's record. A broken chain invalidates every accreditation held through it regardless of the broker's own credentials (ACR-010).

### 8.5 Monitoring item status

Current → Due soon → Overdue → Breached → Resolved

### 8.6 List status

**Black list:** Not listed → Match — pending confirmation → Listed — confirmed → Removed from all lenders → Delisted → Not listed. A confirmed listing sets every accreditation to Suspended — blacklisted and the profile to Blacklisted (Section 12.18).

  

**Grey list:** Draft → Submitted → Active → Broker responded → Withdrawn | Expired | Escalated to black list. Grey status never changes profile or accreditation status — it is advisory (Section 12.19).

  

Every transition in all six models records actor, timestamp, reason and linked evidence.

  

## 9\. Configurable requirement rulesets

Different lenders want different things. Hard-coding one institution's requirements is the fastest way to make the platform single-tenant in practice while claiming multi-tenancy in the data model.

  

Each client organisation configures, per product scope:

  

|  |  |
| :-: | :-: |
| \*\*Configurable\*\* | \*\*Examples\*\* |
| Required documents | Which document types, mandatory vs conditional, validity windows |
| Conditional rules | "Mentoring letter required if experience under 2 years"; "PI minimum $2M for commercial, $500K for equipment finance" |
| Required checks | Which checks from the catalogue, and acceptable age of a reused result |
| Screening thresholds | What constitutes an exception, what auto-declines |
| Approval routing | Roles, sequence, whether a second approver or credit sign-off is required |
| Training | Which modules, completion deadline, whether platform or product training or both |
| Monitoring cadence | Re-check frequency per check type; attestation frequency; reminder schedule |
| Event responses | For each monitoring event type: notify, review, auto-suspend |
| Correspondence | Onboarding pack contents, code of conduct, commission schedule, branding |

  

Rulesets must be versioned. When a client changes its ruleset, existing accreditations are not retrospectively invalidated; the new ruleset applies to new assessments and to the next monitoring cycle (OQ-6).

  

### 9.1 The six dimensions of variance (G-14)

The configurable list above states *that* lenders differ. It does not state *how*, and without that the ruleset engine cannot be designed — only guessed at. Analysis of accreditation documentation from Westpac Group, BOQ, NAB, Maple Asset Finance, Selfco and Firstmac found that variance is not a flat set of per-lender preferences. It runs along **six independent dimensions**, each of which multiplies against the others.

  

This matters because a ruleset keyed on `client_organisation` alone cannot express any of them. **G-14 is the requirement that the ruleset key be a composite of scope, subject and pathway — not a lender identifier.**

  

|  |  |  |
| :-: | :-: | :-: |
| \*\*\#\*\* | \*\*Dimension\*\* | \*\*Evidenced by\*\* |
| \*\*D1\*\* | \*\*Scope granularity.\*\* An accreditation is for a brand-and-role combination, not for a lender | Westpac's single form covers five brands (Westpac Commercial, St George Group, Westpac Equipment Finance, CFAL, Westpac Insurance Broker), each selectable as Broker, Referrer or Professional Services Referrer. NAB distinguishes Equipment Finance ONLY from Commercial. BOQ spans six group entities |
| \*\*D2\*\* | \*\*Accreditation subject.\*\* Whether the individual, the business, or both are the subject of assessment | Maple issues two separate forms with two separate checklists — Introducer (MCF1.01) and Broker Firm (MCF1.02). Westpac and NAB accredit the individual, with the aggregator or broker firm countersigning rather than being separately assessed |
| \*\*D3\*\* | \*\*Document set, validity windows and thresholds.\*\* The same document type carries different currency rules and different minimums — and is sometimes substitutable | Police check: Westpac requires a clearance no older than \*\*180 days\*\*; Maple requires \*\*90 days\*\* \*\*or\*\* accepts recognised industry body membership \*\*instead\*\*. Selfco requires privacy consent no older than 90 days. NAB specifies PI cover of \*\*not less than $1,000,000 per claim and $2,000,000 in aggregate\*\*; other lenders state no figure |
| \*\*D4\*\* | \*\*Eligibility rules conditional on D1.\*\* Requirements change according to the scope selected, within the same lender | NAB Commercial requires a resume evidencing \*\*2 years\*\* business banking experience; NAB Equipment Finance requires the same \*\*and\*\* CAFBA membership. Westpac makes association membership mandatory for CFAL, Equipment Finance and Commercial Broker, but requires \*\*degree qualification or professional association membership\*\* for Commercial Referrer instead |
| \*\*D5\*\* | \*\*Pathway.\*\* New, transfer, or short-form — selected by what the lender already holds or by the applicant's prior status | NAB operates \*\*two distinct forms\*\*: a two-page form for brokers already holding NAB residential accreditation, and a five-page stand-alone form for everyone else. Westpac has a dedicated transfer section requiring an outgoing aggregator release letter. NAB applies a \*\*six-month active broker\*\* window to transfers. Maple requires a letter of separation |
| \*\*D6\*\* | \*\*Declarations, consents and execution.\*\* The declaration set, the consents sought and the acceptable signing method all differ | Westpac's personal declaration runs to \*\*twelve lettered items\*\* (licence refusal, conviction, ASIC investigation, company liquidation, bankruptcy, partnership liquidation, membership refusal, disciplinary action, dismissal, PI claim, PI refusal, accreditation cancellation) and \*\*expressly refuses digital signatures\*\* for the applicant declaration while accepting them for direct agreement holder representatives. NAB instead seeks \*\*VEVO work-rights consent\*\* and, for Equipment Finance only, \*\*appointment as a limited agent under NAB's AML/CTF Program\*\*, plus AML certification and AFCA membership evidence |

  

### 9.2 Consequences for the data model

Four design conclusions follow directly, and all four are cheaper to build now than to retrofit:

  

1.  **The ruleset key is composite.** `(client_organisation, brand, role, product_scope, pathway)` resolves to a ruleset version. A ruleset attached to a lender alone cannot express D1, D4 or D5 (ACR-003).
2.  **Requirements are satisfiable by alternatives, not only by a named document.** Maple's police-check-or-membership rule and Westpac's association-or-degree rule are both `any_of` constraints. A required-documents list modelled as a flat set of mandatory types cannot represent either. The ruleset needs `all_of` / `any_of` / `conditional_on` as first-class constructs — still declarative JSON per Section 23, still no DSL.
3.  **Validity windows and thresholds are ruleset data, not document-type properties.** A police check has no intrinsic currency period; 90 days and 180 days are both correct, for different lenders, over the same stored evidence. Section 7.3's `validity_period` therefore belongs on the ruleset's reference to the check, not on the check type itself.
4.  **Declarations are stored as dated events and derived per lender.** Westpac's twelve items and NAB's four are different questions over the same underlying history. Storing a broker's yes/no answers to one lender's form makes the other lender's form unanswerable without re-asking. Store the events; derive each lender's declaration at render time (Section 6.1).

  

### 9.3 Release 1 acceptance test

Section 23 already requires two seeded rulesets, one modelled on the Westpac worked example and one deliberately different. G-14 sharpens what "deliberately different" has to mean. **The second seeded ruleset should be NAB, because NAB alone exercises D1, D4, D5 and D6 — two brands of scope, scope-conditional eligibility, two pathways, and a declaration set with no overlap with Westpac's.**

  

The epic is not done until a NAB ruleset is expressible as configuration with no change to engine code. If it is not, the abstraction is wrong, and Release 1 is the cheapest moment in the platform's life to find that out. Treated as a design defect, not a backlog item.

  

**Why this is a Release 1 blocker rather than a Release 3 concern.** Reuse across lenders is deferred to Release 3, which makes it tempting to defer the configuration model with it. That is the wrong reading. Release 1's stated proof is that *a second ruleset is expressible without code changes* — the multi-lender data model has to be right before the second lender exists, because the alternative is that every subsequent lender is a development project and the platform is a consultancy with a product's cost base.

  

## 10\. Association-specific requirements

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| ASN-001 | As an association I can see the brokers who have linked to me as members | M |
| ASN-002 | As an association I can confirm or deny a claimed membership number and status | M |
| ASN-003 | Membership status confirmed by the association is treated as authoritative and supersedes an uploaded certificate | M |
| ASN-004 | As an association I can record and update CPD compliance status for a member | S |
| ASN-005 | As an association I can record a change in standing — suspension, expulsion, disciplinary finding, condition imposed. This is an external determination and reaches lenders directly, without platform adjudication | M |
| ASN-006 | A change in membership status or standing raises a monitoring event against the broker and notifies all linked clients. Each lender decides its own response; the platform does not suspend | M |
| ASN-007 | As an association I can invite members to register on the platform | S |
| ASN-008 | As an association I can see, in aggregate, how many of my members are accredited and with whom, subject to the sharing scope granted | C |
| ASN-009 | Membership renewal dates generate monitoring items with reminders to the broker | M |
| ASN-010 | Association integration supports both API confirmation and manual confirmation by an association user, since association technical maturity varies | M |
| ASN-011 | External dispute resolution scheme membership (e.g. AFCA) is captured and monitored as a distinct credential | M |

  

**Note:** ASN-005 and ASN-006 together are the single highest-value monitoring feature. A disciplinary finding reaching every linked lender the same day is something no current process achieves.

  

## 11\. Ongoing monitoring requirements

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| MON-001 | Every document and credential with a validity period generates a monitoring item with a next-due date | M |
| MON-002 | Brokers receive reminders ahead of expiry on a configurable schedule (default 60/30/7 days) | M |
| MON-003 | Brokers can replace an expiring document directly from the reminder or their profile | M |
| MON-004 | On expiry, the item breaches, the profile flags Attention required, and all linked clients are notified | M |
| MON-005 | Licence and credit representative status is re-verified against the source register on a configurable cadence | M |
| MON-005a | \*\*The broker's business entity is re-screened on a configurable cadence:\*\* registration still active and current, GST registration still held, entity not deregistered, and trading status unchanged | M |
| MON-005b | Insolvency, administration, liquidation and external controller appointments are monitored against the business entity | M |
| MON-005c | Directorship and principal changes at the business are detected; a new principal is a screening subject and triggers assessment | M |
| MON-005d | The broker's continued authorisation under their licensee is re-verified — an authorisation withdrawn by the licensee is a high-severity event | M |
| MON-005e | Where a trust structure is involved, trustee status and registration are re-screened alongside the entity | M |
| MON-005f | Entity-level findings propagate to every broker operating under that entity, not just the broker who triggered the check | M |
| MON-006 | Banned and disqualified, insolvency and adverse record checks are re-run on a configurable cadence | M |
| MON-007 | Association membership currency and standing are monitored continuously or on a cadence | M |
| MON-008 | Brokers periodically re-attest that their profile is accurate and no reportable change has occurred | M |
| MON-009 | Brokers can report a change of circumstances at any time, with defined reportable categories | M |
| MON-010 | Failure to attest by the due date is itself a monitoring breach | M |
| MON-011 | Material profile changes made by a broker trigger re-review against each linked client's ruleset | M |
| MON-011a | A change to the broker's aggregator relationship is a material event: linked lenders are notified and each ruleset determines the response | M |
| MON-011b | Aggregator confirmation of panel membership is itself monitored — an unconfirmed or withdrawn confirmation raises an event | M |
| MON-011c | A confirmed black list entry (Section 12.18) raises a high-severity monitoring event and triggers automatic removal — the only event that does so | M |
| MON-011d | A grey list entry (Section 12.19) raises a monitoring event for linked lenders. It is advisory; each lender decides its response | M |
| MON-012 | Each client's ruleset determines whether an event is informational, raises a review task, or auto-suspends the accreditation | M |
| MON-013 | As a client I have a monitoring dashboard showing expiring, expired and breached items across my linked brokers | M |
| MON-014 | As a client I can filter and export my panel's currency position for regulatory or internal reporting | M |
| MON-015 | As a broker I can see all my upcoming and overdue monitoring obligations in one place. Indicator-driven events (RSK-012) are excluded from this view | M |
| MON-016 | As a broker I can see my next scheduled review date | M |
| MON-017 | Monitoring events, notifications and resolutions are fully audited | M |
| MON-018 | Clients can run an on-demand re-check of a specific broker outside the scheduled cadence | S |
| MON-019 | Escalation where a breach remains unresolved beyond a configurable period | S |
| MON-020 | Predictive view: brokers at risk of falling out of currency in the next period | C |

  

## 12\. Functional requirements

MoSCoW: **M** Must, **S** Should, **C** Could. Priorities carried from BRD v0.2 where recorded; otherwise proposed and requiring confirmation (OQ-11).

### 12.1 Platform and tenancy

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| PLT-001 | Data model supports multiple client organisations of types Lender, Aggregator and Association | M |
| PLT-002 | A client organisation can access broker data only where an active relationship exists, enforced at the data access layer | M |
| PLT-003 | Client organisations cannot search, browse or discover brokers they are not linked to | M |
| PLT-004 | Each client organisation has independent configuration, users, roles and branding | M |
| PLT-005 | Cross-tenant access attempts are logged and alerted | M |
| PLT-006 | Thriski administrators can support a client without unrestricted access to broker personal data; elevated access is logged and justified | M |

### 12.2 Registration and authentication

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| AUTH-001 | As a broker I can register for Thriski to start the onboarding journey | M |
| AUTH-002 | As a broker I can sign in to view saved data and continue onboarding | M |
| AUTH-003 | As a broker I can sign out to keep my data secure | M |
| AUTH-004 | As a broker I can change my password | M |
| AUTH-005 | Password reset via verified email | M |
| AUTH-006 | MFA on client organisation accounts | M |
| AUTH-007 | MFA available to brokers | S |
| AUTH-008 | Client user provisioning, role assignment and deactivation by a client administrator | M |

### 12.3 Broker profile build

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| ONB-001 | As a registered broker I can initiate profile build | M |
| ONB-002 | As a broker I must attest to the privacy policy and terms before proceeding | M |
| ONB-003 | As a broker I can provide personal information (Section 13.1) | M |
| ONB-004 | As a broker I can provide business information (Section 13.2) | M |
| ONB-005 | As a broker I can record my licensing: ACL held, or credit representative authorisation and the entity holding the licence | M |
| ONB-006 | As a broker I can record association memberships with number and type | M |
| ONB-007 | As a broker I can upload required documents (Section 14) | M |
| ONB-008 | As a broker I can save progress as a draft and resume | M |
| ONB-009 | As a broker I can see exactly what is outstanding and why | M |
| ONB-010 | As a broker I can use an address lookup | S — elevated from BRD v0.2's C; see Section 6.1a and OQ-45 |
| ONB-011 | As a broker I can record multiple business entities where I operate under more than one | S |
| ONB-012 | As a broker I can record my experience duration, which drives the mentoring-letter conditional rule | M |
| ONB-013 | As a broker, for a required document type the platform can extract data from, I upload the document first and confirm pre-filled values rather than typing them from scratch | S — proposed; see Section 6.1a, OQ-45 |
| ONB-014 | As a broker I can look up my business by ABN/ACN against the national business register and have its registered details pre-filled for confirmation, rather than typing them | S — proposed; see Section 6.1a, OQ-45 |
| ONB-015 | As a broker who started my profile on one device, I can continue document capture on my phone via a short-lived handoff link without losing my session | S — proposed; see Section 6.1a, OQ-45 |
| ONB-016 | As a broker, before being asked for a sensitive field or document, I see a one-line explanation of why it's required | S — proposed; see Section 6.1a |
| ONB-017 | As a broker with an incomplete draft, I receive a reminder after a configurable period of inactivity showing what's left to finish | S — proposed; see Section 6.1a. Distinct from MON-002's post-accreditation expiry reminders |

### 12.4 Broker business onboarding

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| BUS-001 | A broker business is an entity in its own right, onboarded and verified independently of any individual broker | M |
| BUS-002 | As a principal I can register a broker business and complete its onboarding | M |
| BUS-003 | As a broker I can create a business during my own onboarding where one does not yet exist | M |
| BUS-004 | As a broker I can affiliate with an existing verified business rather than re-entering its details | M |
| BUS-005 | Affiliation requires confirmation from the business, so brokers cannot attach themselves to an entity without its knowledge | M |
| BUS-006 | Business details are captured once and shared by all affiliated brokers; there is one authoritative record per entity | M |
| BUS-007 | Every principal — director, secretary, partner, trustee — is captured and screened, whether or not they are themselves a broker | M |
| BUS-008 | Business-level documents (PI cover, registration, entity licence) are held once at the business, not duplicated per broker | M |
| BUS-009 | Entity screening runs at the business: registration currency, GST, corporate status, solvency and external administration, adverse records, banned and disqualified | M |
| BUS-010 | Where the entity is a trust, the trustee is captured and screened alongside it | M |
| BUS-011 | Business status cascades: a business in breach or unverified blocks accreditation for every affiliated broker | M |
| BUS-012 | A business-level monitoring event notifies every lender linked to any affiliated broker | M |
| BUS-013 | Sole traders complete a single combined journey; the platform derives the business record from the individual's details without asking twice | M |
| BUS-014 | A broker can hold affiliations with more than one business, each with role and effective dates | S |
| BUS-015 | Affiliation history is retained, including previous businesses and the dates of each | M |
| BUS-016 | Ending an affiliation is a material change event: linked lenders are notified and accreditations re-evaluated | M |
| BUS-017 | Business-level documents do not transfer with a broker who leaves; the new business's documents apply | M |
| BUS-018 | As a lender I can see the business a broker operates through, its verification status, its principals and its currency position | M |
| BUS-019 | As a lender I can see all brokers on my panel affiliated with a given business, so an entity-level issue can be assessed across my exposure | M |
| BUS-020 | Business entity type drives conditional requirements — signing rules, trustee details, principal counts | M |
| BUS-021 | A business restructure creating a new registered entity is treated as a new business requiring verification, with the prior entity retained in history | M |
| BUS-022 | The business and its principals are screened against both lists; a listed principal raises an event against the business and every affiliated broker (BLK-003) | M |
| BUS-023 | As an aggregator I can onboard a business on behalf of my panel, subject to confirmation by a principal | S |
| BUS-024 | As a broker or principal creating or affiliating with a business, I can search the platform's known businesses and the national business register by ABN/ACN/name before entering anything manually | S — proposed; see Section 6.1a, OQ-45 |

### 12.5 Relationships and sharing

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| REL-001 | As a broker I can search for and select the lenders, aggregators and associations I want to link to | M |
| REL-002 | As a broker I explicitly consent to sharing my profile with each client, and see what will be shared | M |
| REL-003 | As a client I can invite a broker to link to me | M |
| REL-004 | As a broker I can accept or decline a client invitation | M |
| REL-005 | As a broker I can see all my relationships and their status in one view | M |
| REL-006 | As a broker I can revoke a relationship, with confirmation of the consequences | M |
| REL-007 | As a client I can end a relationship, with reason recorded | M |
| REL-008 | Relationship type determines default sharing scope and available actions | M |
| REL-009 | An aggregator can view and confirm its broker panel | M |
| REL-010 | Consent grants and revocations are timestamped, versioned and auditable | M |

### 12.6 Identity verification

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| IDV-001 | As a broker I can confirm I want to complete ID\&V so the system can trigger it | M |
| IDV-002 | System triggers the ID\&V workflow on the broker's election | M |
| IDV-003 | System retrieves and stores all data returned by ID\&V | M |
| IDV-004 | System compares ID\&V data with broker-entered data and highlights disparities | M |
| IDV-005 | As a reviewer I can review the ID\&V result and approve or decline | M |
| IDV-006 | As a client I can see the \*\*full ID\&V result\*\* for a linked broker — all data returned, the documents verified, the provider's own assessment and confidence indicators, and the images or artefacts captured — not a pass/fail status | M |
| IDV-007 | Primary and secondary identity documents are obtained and verified | M |
| IDV-008 | ID\&V result is reusable across clients within a configurable validity window | M |
| IDV-009 | The provider's raw response is retained immutably as the authoritative evidence record; any derived status is a view over it and never a substitute | M |
| IDV-010 | As a client I can see which provider performed the verification, by what method, and at what date and time | M |
| IDV-011 | As a client I can export or produce the complete ID\&V evidence pack for a broker for audit or regulatory purposes | M |
| IDV-012 | Where ID\&V is re-performed, prior results are retained with their validity periods rather than overwritten, so a client can show what was true at the time it relied on it | M |
| IDV-013 | Every client access to ID\&V evidence is logged: who, when, what was viewed | M |
| IDV-014 | The platform supports more than one ID\&V provider, since a lender's ability to rely may depend on which provider was used | S |
| IDV-015 | Where the selected ID\&V provider's SDK offers passive liveness, auto-capture/edge detection or NFC chip reads, the broker-facing flow uses them rather than a custom capture UI — this is a provider-capability check, not new platform build (see Sumsub adapter notes) | S — proposed; see Section 6.1a, OQ-45 |

### 12.7 Screening

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| SCR-001 | System runs the check catalogue in Section 7.1 according to the applicable ruleset | M |
| SCR-002 | Each check records source, request and completion timestamps, result and evidence artefact | M |
| SCR-003 | Evidence is retained immutably and reproducible on request | M |
| SCR-004 | Adverse results create an exception task routed per the client's approval configuration | M |
| SCR-005 | Approvers classify exceptions as proceed, proceed with condition, or decline, with mandatory rationale | M |
| SCR-006 | Check results are reusable across clients per the reuse rules in Section 7.3 | M |
| SCR-007 | Client-specific internal list checks never leave the client's tenancy and are never reused | M |
| SCR-008 | System flags existing or concurrent accreditations held by the broker elsewhere, where sharing scope permits | S |
| SCR-009 | Asynchronous checks are modelled as jobs with pending, complete and failed states, retry and visible SLA | M |
| SCR-010 | As a client I can see the full result and evidence of every check performed on a linked broker, not a summary status | M |
| SCR-011 | Where a check result is reused from an earlier assessment, the client sees the original date, source and evidence, and that it was reused | M |
| SCR-012 | Superseded check results are retained with their validity periods; the history is queryable as at any past date | M |

### 12.8 Documents and data extraction

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| DOC-001 | As a broker I can upload each required document with its type and see what is outstanding | M |
| DOC-002 | System validates documents against the applicable currency and threshold rules | M |
| DOC-003 | System extracts key data from documents to validate them | S |
| DOC-004 | As a reviewer I can see extracted data alongside the source document | S |
| DOC-005 | Extracted values are compared with broker-entered values and disparities highlighted | S |
| DOC-006 | Documents are versioned; superseding a document retains the prior version and its validity period | M |
| DOC-007 | Document sharing respects the relationship sharing scope | M |
| DOC-008 | Supported formats include PDF, common image formats and photographs taken on a mobile device | M |
| DOC-009 | At upload, the platform performs a basic client-side quality check (blurry, unreadable, wrong file type or an obviously blank/incomplete image) and asks the broker to retake before submitting, for document types not already covered by an ID\&V provider's own capture SDK | S — proposed; see Section 6.1a, OQ-45 |

### 12.9 Police and criminal history check

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| POL-001 | As a broker with an in-date certificate I can upload it rather than trigger a new check | M |
| POL-002 | As a reviewer I can review the certificate content | M |
| POL-003 | As a reviewer I can approve a police check | M |
| POL-004 | As a broker I can trigger a police check through an integrated vendor as part of onboarding | C |
| POL-005 | Information already in the profile is passed to the vendor so it is not re-entered | C |
| POL-006 | As a broker I can view the result | C |
| POL-007 | OCR extraction of key certificate data | C |
| POL-008 | As a client I can see the result, subject to consent scope | C |

  

BRD v0.2 contained two identical epics — "Credit check" and "Police certificate check" — with the same eight stories. Treated as a duplicate; credit and bankruptcy checks are handled in the check catalogue (Section 7.1). Confirm at OQ-8.

### 12.10 Broker profile and self-service

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| PRF-001 | As a broker I have a profile showing all my information and documentation | M |
| PRF-002 | As a broker I can see my progress and status | M |
| PRF-003 | As a broker I can see outstanding tasks across all relationships | M |
| PRF-004 | As a broker I can update my information at any time | M |
| PRF-005 | As a broker I can see who my data is shared with and what they can see | M |
| PRF-006 | As a broker I can see my notifications | M |
| PRF-007 | As a broker I can upload a profile photo | S |
| PRF-008 | As a broker I can download or export my own data | S |

### 12.11 Client review and decisioning

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| REV-001 | As a client reviewer I have a work queue filterable by status, type, product scope and age | M |
| REV-002 | As a reviewer I can see the profile, documents and check results on one screen | M |
| REV-003 | As a reviewer I can request further information with itemised reasons | M |
| REV-004 | As a reviewer I can approve or decline with mandatory rationale | M |
| REV-005 | As a relationship manager I can record an interview outcome and recommendation | M |
| REV-006 | Approval routing follows the client's configured sequence, including second approver or credit sign-off | M |
| REV-007 | Declines notify the broker and the sponsoring relationship manager with reasons | M |
| REV-008 | As a broker I can dispute a decline and submit supporting evidence | S |
| REV-009 | Disputes route to the client's configured escalation or committee path | S |
| REV-010 | Committee decisions are recorded and notify the relevant parties | S |
| REV-011 | As a reviewer I can apply conditions to an approval and track their satisfaction | S |
| REV-012 | Bulk actions on a queue where the action is safe to batch | C |
| REV-013 | As a broker I can see which named relationship manager or reviewer is handling my application, where the client's process assigns one | C — proposed; see Section 6.1a, OQ-45 |

### 12.12 Accreditation model

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| ACR-001 | Accreditation is a distinct record referencing four parties: lender, individual broker, broking business, and aggregator / ACL holder | M |
| ACR-002 | Accreditation is granted to the individual broker and carries the lender-issued accreditation or broker ID | M |
| ACR-003 | The lender-issued ID format is lender-specific; the platform stores it rather than generating it (OQ-13) | M |
| ACR-004 | Accreditation records the broker classification: New Broker Introducer, New Referrer Introducer, Transfer, Add-on accreditation | M |
| ACR-005 | Classification drives workflow routing — a transfer requires separation evidence and prior ID lookup; an add-on skips profile build already completed | M |
| ACR-006 | An individual cannot hold both broker and referrer accreditation with the same lender where the lender's rules prohibit it | M |
| ACR-007 | Accreditation is scoped by product where the lender operates product scopes | M |
| ACR-008 | The licence holder is modelled as a role, fillable by the aggregator, the broking business, or a third-party licensee — never assumed to be the aggregator | M |
| ACR-009 | The credit representative arrangement is recorded: which licensee, whether the business is a corporate credit representative, and each individual's authorisation under it | M |
| ACR-010 | \*\*Chain validation:\*\* authority is verified across the whole chain — licence currency, the business's corporate credit representative status, and the individual's authorisation. A break at any level invalidates the accreditation regardless of the broker's own credentials | M |
| ACR-011 | Chain validity is re-verified on the monitoring cadence, not only at onboarding | M |
| ACR-012 | A break in the chain is a high-severity monitoring event notified immediately to every affected lender | M |
| ACR-013 | A change to any of the four parties flags the accreditation for lender action: transfer, re-link, or re-approve, per the lender's ruleset | M |
| ACR-014 | As a lender I can configure my default response to each party change — automatic re-link, review, or full re-approval | M |
| ACR-015 | Accreditation history is retained across transfers and re-links, including prior business, prior aggregator and prior lender-issued IDs | M |
| ACR-016 | As a lender I can see the full accreditation context for a broker: business, aggregator, licence holder, credit representative arrangement, classification and ID | M |
| ACR-017 | Where a broker holds accreditations with several lenders, each is independent; a change propagates to all but each lender decides separately | M |
| ACR-018 | Prior lender-issued IDs are retained and surfaced on transfer, so a lender can reuse or supersede them per its own rules | M |

### 12.13 Training and CPD

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| TRN-001 | As a broker I can complete required training to satisfy a client's compliance requirements | M |
| TRN-002 | Approval triggers issue of the required training | M |
| TRN-003 | Platform tracks the client's completion deadline and shows time remaining | M |
| TRN-004 | Reminders issue to the broker and notify the relationship manager as the deadline approaches | M |
| TRN-005 | Platform and product training are tracked as distinct records | M |
| TRN-006 | Completion records the training and accreditation dates and moves the accreditation to Active | M |
| TRN-007 | As a client I can view training completion across my panel | M |
| TRN-008 | Missing the deadline lapses the accreditation per the client's ruleset | M |
| TRN-009 | CPD hours and compliance status are tracked against the association's requirements | S |
| TRN-010 | Training completed for one client is visible to others where the module is equivalent | C |

### 12.14 Client dashboards

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| CLI-001 | As a client I can see only the brokers who have an active relationship with me | M |
| CLI-002 | As a lender I can see \*\*everything the broker has provided\*\*: every profile field, every uploaded document, every check result with its full underlying evidence, and every ID\&V result in full — sufficient to form my own compliance view rather than accept someone else's | M |
| CLI-003 | As a client I have a panel view with status, currency and outstanding items | M |
| CLI-004 | As a client I can search and filter my own panel only | M |
| CLI-005 | As an aggregator I have full visibility of my brokers: profile, documents, all check results and evidence, ID\&V, business detail, list status, and which lenders they are accredited with | M |
| CLI-005a | Aggregator visibility is broader than lender visibility by design. The aggregator sits in the authority chain, carries the licence and is accountable for the broker's licensing and training; lenders are peers of one another and see less | M |
| CLI-006 | As a client I can export panel data for internal reporting | M |
| CLI-007 | As a client I can onboard a broker on their behalf, with the broker confirming and consenting | C |
| CLI-008 | As a client I can view compliance reporting: currency rates, breaches, ageing | S |
| CLI-009 | As a lender I can see which aggregator each of my brokers operates under, with status and effective dates | M |
| CLI-010 | As a lender I can see that the aggregator has confirmed the broker is on its panel, and when | M |
| CLI-011 | As a lender I can see each broker's association memberships: association, membership number, status, standing, and whether association-confirmed or certificate-only | M |
| CLI-012 | As a lender I can see the history of aggregator and association relationships, including prior aggregators | M |
| CLI-013 | As a lender I am notified when a broker's aggregator or association relationship changes, lapses or is suspended | M |
| CLI-014 | As a lender I can view a broker's complete compliance picture on one screen: profile, documents, checks with evidence, ID\&V, aggregator link, association standing, training and monitoring position | M |
| CLI-015 | A lender cannot see which other lenders a broker is accredited with, unless separately configured and consented (OQ-19) | M |
| CLI-016 | As a lender I can produce the complete compliance picture as a point-in-time evidence pack | M |

### 12.15 Notifications

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| NOT-001 | Brokers are notified on submission, information requests, approval, decline, training issue and monitoring events | M |
| NOT-002 | Client users are notified when a task enters their queue and when a check or monitoring event returns | M |
| NOT-003 | Onboarding pack issued on activation: code of conduct, identifiers, commission schedule, access details | M |
| NOT-004 | Pack can be routed via a nominated relationship manager where the client's process requires it | S |
| NOT-005 | Notification preferences configurable per user, with mandatory categories that cannot be disabled | M |
| NOT-006 | Credentials are never transmitted in plain text | M |
| NOT-007 | All notifications logged against the relevant record | M |
| NOT-008 | Digest options for high-volume client users | C |

### 12.16 In-solution chat

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| CHT-001 | As a reviewer I can message a broker in-solution | C |
| CHT-002 | As a broker I can reply | C |
| CHT-003 | As a client I can message a broker directly | C |
| CHT-004 | A client can only message brokers with an active relationship | M (if built) |

### 12.17 Audit

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| AUD-001 | Immutable event log of every status change, check, decision, notification, consent change and data access | M |
| AUD-002 | As a client I can produce a complete accreditation and monitoring history for a broker for a regulator or internal audit | M |
| AUD-003 | As a broker I can see the access history for my own profile: which organisations viewed what, and when | M |
| AUD-004 | Audit records are retained per the retention policy and are tamper-evident | M |
| AUD-005 | \*\*Point-in-time reconstruction:\*\* the platform can show a broker's complete verified state as at any past date — which checks were current, what they returned, which documents were valid, what the accreditation status was | M |
| AUD-006 | Evidence artefacts are content-hashed at capture; integrity is verifiable on retrieval | M |
| AUD-007 | Client access to broker evidence is logged at record level, not session level | M |
| AUD-008 | As a client I can produce an evidence pack for a broker as at a specified date, suitable for submission to a regulator | M |
| AUD-009 | Audit and evidence records survive relationship revocation and broker deactivation for the retention period required by the relying client (OQ-9) | M |
| AUD-010 | Audit history is exportable in a machine-readable format | S |

### 12.18 Consolidated list — black list

Implements Section 2.6. Black list entries derive only from external determinations.

  

**Lifecycle:** Not listed → Match — pending confirmation → Listed — confirmed → Removed from all lenders → Delisted → Not listed

  

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| BLK-001 | The platform maintains a consolidated black list, sourced from regulator registers, court and insolvency records, association determinations, and any industry list Thriski can obtain access to | M |
| BLK-002 | No lender or aggregator can create a black list entry. Entries derive only from an external determining body | M |
| BLK-003 | Every broker, business and principal is screened against the black list at onboarding, before any accreditation is granted | M |
| BLK-004 | Screening re-runs continuously or on a high-frequency cadence, so a broker listed after onboarding is caught within the cadence | M |
| BLK-005 | A match is confirmed against identifying data before action; near-matches raise a review task rather than triggering removal | M |
| BLK-006 | On a confirmed listing the broker is flagged Blacklisted and removed from every lender, with all accreditations set to Suspended — blacklisted | M |
| BLK-007 | Automatic removal applies \*\*only\*\* to a confirmed black list entry. No other event causes the platform to suspend an accreditation | M |
| BLK-008 | Every affected lender is notified immediately with the determining body, determination date and matched identifiers | M |
| BLK-009 | The broker is notified immediately with the reason, the determining body, and that any challenge lies with that body | M |
| BLK-010 | The platform records the determination; it does not review it and is not an appeal path | M |
| BLK-011 | On delisting by the determining body, the flag clears and all parties are notified; reinstatement is each lender's decision, never automatic | M |
| BLK-012 | Every listing, match, notification and delisting is immutably audited with the source record retained | M |
| BLK-013 | Black list status and history are visible to every linked lender and aggregator | M |
| BLK-014 | A blacklisted broker retains access to their own profile and can see their status, but cannot establish new relationships while listed | M |
| BLK-015 | Where a source has no API, screening falls back to scheduled import with the same cadence and audit requirements | M |
| BLK-016 | Correction path where the platform confirms a match in error, including reversal of all removals and notification to every party informed | M |

### 12.19 Consolidated list — grey list

Contributor-asserted concerns. Advisory only. Requires the governance framework at OQ-41 before release.

  

**Lifecycle:** Draft → Submitted (evidence and category present) → Active → Broker responded → Withdrawn | Expired | Escalated to black list (only on an external determination)

  

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| GRY-001 | As a lender or aggregator I can record a grey list entry against a broker I have an active relationship with | M |
| GRY-002 | An entry requires a category from a defined taxonomy, a severity, and supporting evidence. Entries without evidence cannot be submitted | M |
| GRY-003 | The contributing organisation is recorded and accountable for the entry | M |
| GRY-004 | Whether the contributor is identified to other lenders, or only to Thriski, is configurable per the governance framework (OQ-41) | M |
| GRY-005 | The broker is notified when an entry is created against them, and can see its category, substance and evidence | M |
| GRY-006 | The broker can record a response with their own evidence; the response is attached to the entry and visible wherever the entry is visible | M |
| GRY-007 | A grey entry \*\*never\*\* triggers automatic removal, suspension or any platform-initiated action | M |
| GRY-008 | Linked lenders are notified of an entry and each decides its own response | M |
| GRY-009 | Entries are presented as unadjudicated concerns raised by a market participant, never as findings. Interface wording is a requirement, not a design detail | M |
| GRY-010 | Entries expire on a period defined per category and severity, after which they leave the shared view | M |
| GRY-011 | A contributor can withdraw its own entry at any time; withdrawal propagates to everyone who saw it | M |
| GRY-012 | Thriski does not adjudicate entries. It hosts, evidences, notifies and expires them | M |
| GRY-013 | A broker can dispute an entry to the contributor through the platform; the contributor must respond within a defined period or the entry lapses | M |
| GRY-014 | An entry escalates to the black list only where an external body subsequently makes a determination — never by platform or contributor decision | M |
| GRY-015 | Grey entries are excluded from the conduct risk indicator, since they are assertions rather than determinations (RSK-002) | M |
| GRY-016 | Rate limiting and pattern monitoring on contributions, with review where one organisation lists at an anomalous rate | M |
| GRY-017 | Full lifecycle immutably audited: creation, evidence, notification, response, dispute, withdrawal, expiry | M |
| GRY-018 | Contribution is available only to organisations that have accepted the governance framework | M |

### 12.19a Lender-private concerns

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| LRC-001 | As a lender I can record a concern visible only to me, without contributing it to the grey list | M |
| LRC-002 | A private concern never propagates and is never an input to anything shared | M |
| LRC-003 | As a lender I can promote a private concern to a grey list entry, which then follows Section 12.19 including broker notification | M |
| LRC-004 | As a lender I can end my own accreditation on the basis of my own concern, with reason recorded | M |

### 12.20 Metering and billing

Billing is per broker, charged to lenders; the fee and precise basis are still to be set. The platform must capture the underlying usage regardless, so the basis can be decided or changed without re-instrumenting.

  

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| BIL-001 | Every billable event emits an immutable metering record at the time it occurs: client, broker, event type, timestamp | M |
| BIL-002 | Metering captures all plausible bases so the model can change without rework: brokers linked, brokers accredited, brokers actively monitored in a period, checks performed, checks reused | M |
| BIL-003 | As a client I can see my current broker count and its composition | M |
| BIL-004 | Usage is reportable by billing period, per client | M |
| BIL-005 | Counting rules are explicit and configurable: how a broker linked mid-period is treated, how a broker linked to several clients is counted, whether declined or lapsed brokers count (OQ-10) | M |
| BIL-006 | Metering records are immutable and reconcilable — a disputed invoice can be traced to the events that produced it | M |
| BIL-007 | Metering is separate from the audit log; the two must not be conflated, since they have different retention, access and integrity requirements | M |
| BIL-008 | Invoicing and payment integration | C |

  

### 12.21 Private lender assessment

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| PLA-001 | As a lender I can add a broker on my panel to an internal watch list, with reason and severity | M |
| PLA-002 | As a lender I can record an internal rating or assessment against a broker | S |
| PLA-003 | Private assessments are visible only to the lender that created them and are never shared, aggregated, or used as an input to the shared indicator | M |
| PLA-004 | Private assessments are not visible to the broker | M |
| PLA-005 | As a lender I can use my watch list to drive my own review intensity and monitoring cadence | M |
| PLA-006 | As a lender I can promote a private assessment into a grey list entry, which then follows Section 12.19 including mandatory evidence and broker notification | M |
| PLA-007 | Private assessments are audited within the lender's tenancy | M |
| PLA-008 | Private assessments carry a review date so watch-list entries are not left indefinitely | S |

### 12.22 Shared conduct risk indicator

|  |  |  |
| :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* | \*\*MoSCoW\*\* |
| RSK-001 | The platform calculates a conduct risk indicator per broker, visible to all linked lenders | M |
| RSK-002 | Inputs are restricted to the externally determined and objectively measurable set in Section 2.7. No lender's subjective rating, private assessment or recorded concern is ever an input | M |
| RSK-002a | Grey list entries are excluded — they are assertions, not determinations. Including them would let contributor opinion drive a shared value indirectly, which Section 2.7 exists to prevent | M |
| RSK-002b | With no platform adjudication, the indicator rests on external determinations, screening outcomes and objective measures. It is thinner than earlier drafts assumed — see OQ-27 | M |
| RSK-003 | Loan arrears and defaults generally are excluded; early payment default is included as an origination-quality signal | M |
| RSK-004 | Every rate-based input is benchmarked against a peer cohort and suppressed below a minimum volume threshold | M |
| RSK-005 | Every input decays over a defined period; weightings by severity and recency are configurable | M |
| RSK-006 | The indicator is presented with its components; a bare number is never displayed alone | M |

  

| RSK-007 | The indicator value, its components and its weightings are **not visible to the broker**. The underlying inputs remain visible to them through their existing channels — compliance findings, screening exceptions, monitoring breaches | M | | RSK-008 | As a lender I can configure my own weightings to reflect my risk appetite, without altering the shared inputs | S | | RSK-009 | The indicator informs triage, review intensity and monitoring cadence; it must not automatically approve, decline or suspend | M | | RSK-010 | Indicator values are versioned and stored with their inputs and model version, and are reconstructable as at any past date | M | | RSK-011 | Protected attributes are excluded, and indirect proxies are tested for and documented | M | | RSK-012 | An indicator change generates a monitoring event for **linked lenders only**. Indicator-driven events are suppressed from broker-facing notifications and from the broker's monitoring view (MON-015), since the indicator is not visible to them (RSK-007) | M | | RSK-013 | Where a listing is removed or an external determination is overturned or expires, the indicator recalculates and the change propagates | M | | RSK-014 | A broker disputes an indicator input through the path for that input — appealing a compliance finding, correcting a document, resolving a monitoring breach. There is no separate route to dispute the indicator itself, since they cannot see it | M | | RSK-015 | Indicator methodology is documented and disclosable to lenders and to a regulator. Disclosure to brokers is withheld by default, subject to OQ-32 | M | | RSK-016 | Feedback-loop monitoring: the platform reports on whether high-indicator brokers accumulate findings at a rate disproportionate to their conduct | S | | RSK-017 | Outcome data is captured deliberately from launch so the indicator can later be validated and calibrated against real results | M | | RSK-018 | Migration path from a transparent rules-based indicator to a calibrated model, without invalidating historical values | C |

  

## 13\. Data requirements

### 13.1 Personal

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| \*\*Field\*\* | \*\*Type\*\* | \*\*Required\*\* | \*\*Notes\*\* |
| First name | Free text | Y |   |
| Last name | Free text | Y |   |
| Any other / previous names | Free text | N | Needed for accurate screening |
| Date of birth | Date | Y |   |
| Gender | Enum: Male, Female, Other | N | Collect only where a downstream requirement exists |
| Email address | Email | Y | Unique per account |
| Phone number | Phone | Y |   |
| Mobile number | Phone | Y |   |
| Residential address | Address block | Y | Line 1, line 2, city, postcode, state |
| Postal address | Address block | Conditional | Where different |
| Years of experience | Number | Y | Drives conditional mentoring requirement |
| Right-to-work / visa status | Enum + document | Conditional |   |

### 13.2 Business

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| \*\*Field\*\* | \*\*Type\*\* | \*\*Required\*\* | \*\*Notes\*\* |
| Legal entity name | Free text | Y | Full name of the contracting entity, matching the registration. For a trust, include the trustee, e.g. "ABC Pty Ltd as trustee for ABC Trust" |
| Trading name | Free text | Y |   |
| Registration number type | Enum: ABN, ACN, other | Y | Extensible for non-Australian jurisdictions |
| Registration number | String | Y | Format-validated per type |
| GST registration status | Boolean | Y | Some clients require it |
| Trustee name and registration | Free text + number | Conditional | Where the entity is a trust |
| Website | URL | N |   |
| Business email | Email | Y |   |
| Correspondence email | Email | N |   |
| Commission statement email | Email | N | Client-specific |
| Principal(s) name and email | Repeating | Y | Principals are screened subjects |
| Business address | Address block | Y |   |
| Mailing address | Address block | Conditional |   |
| Entity type | Enum: company, sole trader, partnership, trust | Y | Drives signing and document rules |

### 13.3 Licensing and accreditation

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| \*\*Field\*\* | \*\*Type\*\* | \*\*Required\*\* | \*\*Notes\*\* |
| Licence type held | Enum: own credit licence, credit representative, exempt | Y |   |
| Credit licence number | String | Conditional |   |
| Credit representative number | String | Conditional |   |
| Licensing entity name and number | Free text + string | Conditional | The entity whose licence the broker operates under |
| Financial services licence / authorised rep number | String | Conditional | Required by some product scopes |
| Licence status and last verified date | Enum + date | System | From register re-verification |
| Association | Enum, repeating | Y | Membership held in the individual's own name |
| Membership number | String | Y |   |
| Membership status, standing and renewal date | Enum + date | System | Association-confirmed |
| External dispute resolution scheme membership | Reference | Y |   |
| CPD status and period | Enum + period | S |   |
| Broker classification | Enum: New Broker Introducer, New Referrer Introducer, Transfer, Add-on accreditation | Y | Per accreditation. Drives workflow routing (ACR-005) |
| Lender-issued accreditation / broker ID | String | System | Per accreditation; format is lender-specific, stored not generated |
| Prior lender-issued ID | String | Conditional | Retained on transfer |
| Licence holder role | Enum: aggregator, own business, third-party licensee | Y | Never assumed to be the aggregator |
| Corporate credit representative status | Enum + dates | Conditional | Business's authorisation under the licensee |
| Chain validity | Derived | System | Licence + corporate credit rep + individual authorisation, all current |
| Product scopes sought | Multi-select | Y | Per relationship |
| Accreditation dates | Date | System | Per accreditation |
| Next review / monitoring date | Date | System |   |
| Prior identifier at a client | String | Conditional | For transfers and re-accreditations |

  

## 14\. Document requirements

Document types are platform-level; **which are required, and their validity windows, are client-configurable** (Section 9). Defaults below are derived from current market practice.

  

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| \*\*Document type\*\* | \*\*Subject\*\* | \*\*Typical validity\*\* | \*\*Notes\*\* |
| Industry qualification (e.g. Certificate IV in Finance and Mortgage Broking) | Person | No expiry | Equivalents accepted |
| Diploma / higher qualification | Person | No expiry | Required by some clients |
| Association membership certificate | Person | Annual | Superseded by association confirmation where available |
| External dispute resolution scheme membership | Person / business | Annual |   |
| Police / criminal history certificate | Person | 3–12 months at submission; re-check periodically | \*\*Validity varies by client — must be configurable\*\* |
| Professional indemnity certificate of currency | Business | Annual | Minimum cover amount is client- and product-specific |
| Credit licence or credit representative certificate | Person / business | Until varied | Verified against the register, not just the certificate |
| Financial services licence / authorised rep certificate | Business | Until varied | Conditional on product scope |
| Resume / work history | Person | Refresh on material change |   |
| Credit report including bankruptcy | Person | Point in time; re-check periodically | Consent required |
| Mentoring confirmation letter | Person | Until experience threshold met | Conditional: experience under 2 years |
| Right-to-work / visa documentation | Person | Per visa expiry | Conditional |
| Separation / exit letter from previous aggregator | Person | Point in time | Required on transfer; must confirm no adverse circumstances |
| Transfer form | Person | Point in time | Format is aggregator- or association-specific |
| Signed application or declaration | Person | Per submission |   |
| Client-specific forms | Varies | Varies | Configurable per client |

  

Every document carries: type, subject, issue date, expiry date, issuing body, file, extracted data, version, verification status and sharing scope.

  

## 15\. Integrations

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| \*\*Integration\*\* | \*\*Direction\*\* | \*\*Purpose\*\* | \*\*Priority\*\* |
| \*\*Identity verification provider\*\* | Write / read | Document and biometric ID\&V | M |
| \*\*National business register\*\* | Read | Entity registration, currency, GST, trust and trustee details | M |
| \*\*Corporate register\*\* | Read | Company status | M |
| \*\*Regulator professional registers\*\* | Read | Credit licence, credit representative, financial services licence and authorised representative status | M |
| \*\*Banned and disqualified register\*\* | Read | Individual and organisation prohibitions | M |
| \*\*Credit bureau\*\* | Read | Company search, principals, adverse records, bankruptcy | M |
| \*\*Associations (MFAA, FBAA, CAFBA, AFCA and equivalents)\*\* | Read / write | Membership currency, standing, CPD, disciplinary events | M — with manual fallback |
| \*\*Police check vendor\*\* | Write / read | Criminal history certificate | C |
| \*\*Client systems of record\*\* | Write | Create and update the broker record in the client's own platform | M |
| \*\*Client training platforms\*\* | Write / read | Issue training, retrieve completion | M |
| \*\*Client identity provider (SSO)\*\* | Read | Client user authentication | S |
| \*\*E-signature and document generation\*\* | Write / read | Agreements, declarations, onboarding packs | M |
| \*\*Email / notification service\*\* | Write | All outbound communication | M |
| \*\*National business register (real-time lookup for onboarding UX)\*\* | Read | ABN/ACN lookup and entity-detail pre-fill during broker/business onboarding, distinct from the periodic re-verification use above — see ONB-014, BUS-024 | S — proposed; see Section 6.1a, OQ-45 |

  

**Design constraints:**

  

  - Every external source needs a **manual fallback**. Association APIs in particular will range from mature to nonexistent (ASN-010). A verification the platform cannot automate must still be capturable as a reviewer action with evidence.
  - Client system-of-record integration must be **adapter-based**. Each client will have a different target system, different field mappings and different provisioning latency. Do not build the first client's integration into the core.
  - Asynchronous integrations — provisioning, screening bureaux, police checks, association confirmations — are jobs with pending, complete and failed states, retry policy and visible SLA. Never blocking calls.

  

## 16\. Non-functional requirements

|  |  |
| :-: | :-: |
| \*\*ID\*\* | \*\*Requirement\*\* |
| NFR-SEC-1 | Tenant isolation enforced at the data access layer; relationship-scoped authorisation on every read |
| NFR-SEC-2 | Role-based access control within each tenant |
| NFR-SEC-3 | Encryption in transit and at rest; documents in access-controlled object storage |
| NFR-SEC-4 | MFA mandatory for client users, available for brokers |
| NFR-SEC-5 | No credential stored or transmitted in plain text, including in generated correspondence |
| NFR-SEC-6 | Penetration testing and vulnerability management appropriate to a platform holding financial-services personal data |
| NFR-PRV-1 | Personal information handled per the Privacy Act 1988 and the Australian Privacy Principles; explicit, granular, revocable consent captured before any sharing or screening |
| NFR-PRV-2 | Data minimisation — collect only what a configured requirement justifies |
| NFR-PRV-3 | Broker can access, export and request correction of their own data |
| NFR-PRV-4 | \*\*Evidence, check results and audit records are retained for 7 years\*\* from the date of capture, or from the end of the relationship where later, whichever the retention rule for that type specifies. Retention survives relationship revocation and broker deactivation |
| NFR-AUD-1 | Immutable, tamper-evident audit log |
| NFR-AUD-2 | Evidence is stored append-only. No process may overwrite or delete a check result, provider response or evidence artefact within its retention period — corrections are new records, not edits |
| NFR-AUD-3 | \*\*7-year retention\*\* applies to all evidence, reflecting the relying lender's regulatory obligations, which outlast the relationship. A former client can retrieve evidence for a broker no longer on its panel throughout that period |
| NFR-AUD-4 | Evidence storage is sized for 7-year retention of full provider payloads and artefacts across the whole panel — a materially larger storage profile than a status-only model. Tiered or cold storage for aged evidence is acceptable provided retrieval remains possible within a defined period |
| NFR-AUD-5 | Deletion is scheduled and automatic at the end of the retention period, and is itself audited |
| NFR-CMP-1 | The platform must let a lender evidence that it dealt only with appropriately licensed brokers or authorised credit representatives, and let an aggregator evidence that it ensured its brokers met licensing and training requirements — continuously, not just at onboarding |
| NFR-PER-1 | Applicant experience is mobile-first; document capture by phone camera. This includes cross-device continuation (ONB-015) so a broker is never forced to complete an entire journey on one device |
| NFR-PER-2 | Client dashboards perform at panel sizes in the thousands of brokers |
| NFR-PER-3 | The broker-facing applicant experience meets WCAG 2.2 AA — proposed; not previously specified. Given NFR-PER-1's mobile-first mandate and the "adoption problem, not a revenue one" framing in Section 1.1, an inaccessible flow is a direct supply-side risk, not only a compliance one. See OQ-46 |
| NFR-SCL-1 | Architecture supports onboarding new client organisations without code changes |
| NFR-AVL-1 | Availability target and support hours TBC |
| NFR-LOC-1 | Data residency requirements TBC; assume Australian residency for MVP |

### 16.1 Regulatory context

Requirements are shaped by: the **NCCP Act 2009** (licensing, responsible lending, National Credit Code), **Competition and Consumer Act / ASIC Act**, state and territory finance broker legislation, the **Do Not Call Register Act**, the **Code of Banking Practice**, the **Corporations Act 2001**, the **Privacy Act 1988** and **AML/CTF** obligations. Lender codes of conduct — which typically bind introducers on the same terms as brokers — form part of the onboarding pack.

  

The regulatory anchor for ongoing monitoring: a lender may only deal with brokers who are appropriately licensed or authorised, and typically relies on aggregators to ensure licensing and training are maintained. That reliance is currently unevidenced between accreditation events. Making it continuously evidenced is the platform's core compliance proposition.

  

## 17\. Open questions

|  |  |  |  |
| :-: | :-: | :-: | :-: |
| \*\*ID\*\* | \*\*Question\*\* | \*\*Owner\*\* | \*\*Blocks\*\* |
| OQ-1 | \*\*Resolved.\*\* Lenders are the paying client and the commercial entry point | — | — |
| OQ-2 | \*\*Resolved.\*\* Authority flows ACL holder → business → broker; the chain must exist before lender accreditation is valid | — | — |
| OQ-3 | \*\*Assumed settled\*\* — lenders can rely on platform KYC and ID\&V. Remaining: validity window per point-in-time check type | Compliance | SCR-006 |
| OQ-4 | \*\*Resolved for lenders and aggregators.\*\* Lenders see everything except other lenders' relationships; aggregators see everything including lender accreditations. \*\*Open: association scope\*\* — default is membership-related data only | Product | CLI-002, CLI-005 |
| OQ-5 | \*\*Resolved.\*\* The platform notifies; the lender decides. No monitoring event auto-suspends an accreditation except a confirmed blacklist listing (BLK-006) | — | — |
| OQ-6 | When a lender changes its requirement ruleset, what happens to existing accreditations? \*\*Related, not yet covered:\*\* what happens to a broker's in-progress, not-yet-submitted draft when the applicable ruleset changes mid-draft — apply the new ruleset retroactively to the draft, or let them finish under the version they started against? See OQ-45 | Product | Section 9 |
| OQ-7 | Which associations will integrate, and at what technical maturity? Manual fallback assumed; confirmation SLA needs agreeing | Partnerships | ASN-002, ASN-010 |
| OQ-8 | Is a separate automated credit/bankruptcy service required, beyond the bureau check in the catalogue? | Product | 12.9, 7.1 |
| OQ-9 | \*\*Resolved.\*\* 7-year retention for evidence, check results and audit records, surviving relationship revocation and broker deactivation. Remaining: whether archive storage for brokers no longer on any panel is absorbed or separately charged — a costing question, not a design blocker | Commercial | NFR-PRV-4, NFR-AUD-3 |
| OQ-10 | \*\*Resolved.\*\* Per broker, averaged across the year. Billing automation is not MVP; metering still captures from day one (BIL-001) | — | — |
| OQ-11 | Confirm MoSCoW priorities across the document | Product | Release planning |
| OQ-12 | \*\*Resolved.\*\* Monitoring is in MVP, covering broker and business | — | — |
| OQ-13 | Lender-issued broker ID: stored per lender. Confirm no platform-issued portable identifier is wanted | Product | ACR-003 |
| OQ-14 | Australia-only for MVP, or must the model accommodate other jurisdictions' registers from the start? | Product | Data model |
| OQ-15 | Sign-off on drafted content filling v0.2's empty epics | Product | Multiple |
| OQ-16 | \*\*ID\&V provider covering both individuals (KYC) and businesses (KYB).\*\* Selection criteria: single provider for both subjects, lender acceptance for reliance, full payload return rather than a pass/fail, and Australian coverage of the required document set | Product / Vendor | IDV-\*, BUS-009 |
| OQ-17 | Merged into OQ-9 | — | — |
| OQ-18 | \*\*Resolved.\*\* Pull model: a linked lender can view and download the broker's information and evidence. No push into lender systems in MVP | — | — |
| OQ-19 | Concurrent-accreditation disclosure: still off. Revisit only if a lender makes a specific case | Product | CLI-015 |
| OQ-20 | \*\*Resolved.\*\* Aggregator and association links are within standard relationship consent | — | — |
| OQ-21 | \*\*Accepted.\*\* Proceeding on the basis that the regime is permissible. The blacklist model materially reduces the exposure that prompted this question: lenders respond independently to an external industry determination rather than sharing adverse information with each other | — | — |
| OQ-22 | \*\*Resolved.\*\* Nobody adjudicates on the platform. Determinations are external — industry body or association | — | — |
| OQ-23 | Privacy basis and broker-facing consent wording for blacklist screening and cross-lender removal | Legal | Section 2.6, BLK-016 |
| OQ-24 | \*\*Withdrawn.\*\* No platform finding taxonomy is needed; the industry body's categories apply | — | — |
| OQ-25 | \*\*Resolved.\*\* The appeal path is the industry body's, not the platform's (BLK-009) | — | — |
| OQ-26 | \*\*Resolved.\*\* The compliance regime is in MVP as blacklist screening plus private assessment | — | — |
| OQ-27 | Indicator weightings and decay periods. With adjudicated findings removed, the input set is thinner — confirm the indicator still earns its place in MVP | Compliance / Product | RSK-002a |
| OQ-28 | \*\*Parked.\*\* Which objective inputs lenders can supply from origination systems | Technical | RSK-002 |
| OQ-29 | Peer cohort definition and minimum volume thresholds for rate-based inputs | Product / Data | RSK-004 |
| OQ-30 | Legal view on the indicator: privacy and automated-decision implications of a shared value affecting livelihood | Legal | Section 2.7 |
| OQ-31 | \*\*Resolved.\*\* Brokers do not see the indicator | — | — |
| OQ-32 | Access-request exposure: the indicator is personal information, so a broker may be entitled to it on request under APP 12 regardless of the product hiding it. Agree the position and response process before launch | Legal | RSK-007 |
| OQ-33 | \*\*Resolved.\*\* Thriski does not adjudicate, so assumes no determination liability | — | — |
| OQ-34 | \*\*Resolved.\*\* A principal or the aggregator initiates business onboarding | — | — |
| OQ-35 | \*\*Resolved.\*\* Accreditation is a four-party record granted to the individual | — | — |
| OQ-36 | \*\*Resolved.\*\* A party change flags the accreditation as Party changed — pending lender re-acceptance. It is not suspended; the lender re-accepts | — | — |
| OQ-37 | \*\*Resolved.\*\* Reliance sits with whoever holds the ACL — aggregator, the business itself, or a third-party licensee. Linking must be completed regardless | — | — |
| OQ-38 | Which external sources feed the black list, and can Thriski obtain machine access to each: regulator registers, court and insolvency records, association determinations, and any existing industry list | Partnerships / Technical | BLK-001 |
| OQ-39 | Match confidence: what identifying data is sufficient to confirm a black list match before removing a broker from every lender | Product / Legal | BLK-005, BLK-016 |
| OQ-40 | Grey list taxonomy, severity scale and expiry period per category | Compliance / Product | GRY-002, GRY-010 |
| OQ-41 | \*\*Grey list governance framework.\*\* Who may contribute, on what evidentiary basis, whether the contributor is identified to other lenders, how a broker challenges an entry, and what happens to an organisation that misuses it. This is a written framework contributors accept, not a configuration setting — and it gates release of the grey list | Legal / Product | All of GRY-\* |
| OQ-42 | \*\*Legal view on hosting the grey list.\*\* Thriski is the publisher of contributor assertions about identifiable individuals, and competing lenders are naming brokers on a shared record. Defamation and competition law both apply. The controls in Section 2.6 are the intended mitigation — confirm they are sufficient before the grey list is built | Legal | Section 2.6 |
| OQ-43 | Privacy basis and broker-facing consent wording for both lists, including cross-lender removal | Legal | Section 2.6 |
| OQ-44 | Should the grey list ship in the same release as the black list, or follow once the governance framework has been tested with participants? Recommendation in Section 2.6 is to sequence it second | Product | Release planning |
| OQ-45 | \*\*Onboarding UX enhancements (Section 6.1a): which to commit to Release 1 and in what order.\*\* Covers document-first capture (ONB-013), business registry lookup (ONB-014, BUS-024), cross-device handoff (ONB-015), contextual purpose copy (ONB-016), abandoned-draft reminders (ONB-017), ID\&V provider SDK capability reuse (IDV-015), and upload quality gating (DOC-009). None change the compliance regime; all change build sequencing within Epic 3/4/6 of the Release 1 backlog. Business registry lookup specifically needs a provider decision — Australia's ABN Lookup web service is free and public, which is a strong default, but confirm before building against it | Product / Engineering | Release 1 Backlog Epics 3, 4, 6 |
| OQ-46 | Accessibility target and timeline (NFR-PER-3): commit to WCAG 2.2 AA for the broker-facing applicant experience for Release 1, or treat as a fast-follow? No decision recorded before this session | Product | NFR-PER-3 |
| OQ-47 | Named relationship-manager visibility during review (REV-013): does showing "who's reviewing this" to the broker fit the Westpac-derived workflow, or does it commit to a level of client-side process transparency not every lender will want configurable per-client? | Product | REV-013 |

  

**Note on OQ-4 — association scope.** Lender and aggregator scopes are settled. An association's role is confirming membership, standing and CPD, which is mostly data flowing *to* the platform. Whether it should see anything of the broker's lender-side accreditation, screening results or business detail is a product decision with little compliance justification behind it. The safe default, and the current assumption, is membership-related data only.

  

# Part B — Technical architecture and delivery

*Companion to Part A. Assumes the requirements above; does not restate them.*

## 18\. What the architecture has to survive

Most of this platform is ordinary CRUD. Five things are not, and they should drive every structural decision. If the architecture gets these right, the rest is unremarkable web application work.

  

|  |  |  |
| :-: | :-: | :-: |
| \*\*Driver\*\* | \*\*Requirement\*\* | \*\*Consequence if wrong\*\* |
| \*\*Relationship-scoped authorisation\*\* | A client sees a broker only through an active relationship (PLT-002) | A cross-tenant leak in a platform holding identity documents and adverse findings is an existential incident, not a bug |
| \*\*Immutable evidence, 7-year retention\*\* | Full provider payloads retained, never mutated, reproducible years later (NFR-AUD-2/3) | A lender's reliance defence collapses; the core product claim fails |
| \*\*Point-in-time reconstruction\*\* | Show what was true as at any past date (AUD-005) | Retrofitting temporality into a mutable schema is a rewrite, not a migration |
| \*\*Continuous monitoring at panel scale\*\* | Thousands of brokers, dozens of check types, per-lender cadences | Either it doesn't run, or it hammers external providers and costs more than the revenue |
| \*\*Per-lender configurability\*\* | Requirements, cadences and responses differ per lender (Section 9) | The first lender's rules calcify into the code and multi-tenancy becomes fiction |

  

Everything below follows from these.

  

## 19\. Shape: modular monolith

**Build one deployable application with enforced internal module boundaries. Not microservices.**

  

The reasoning is specific to this product, not general preference:

  

  - The domain boundaries are still moving. Three of the last six BRD versions restructured core entities — accreditation went from a two-party to a four-party model, and the compliance regime was redesigned twice. Service boundaries drawn now would be drawn wrong, and moving a boundary between services is dramatically more expensive than moving one between modules.
  - The consistency requirements are strong and cross-cutting. A blacklist confirmation must atomically suspend every accreditation across every lender. That is one transaction in a monolith and a distributed saga otherwise.
  - Authorisation is the highest-risk area and must be enforced in exactly one place. Distributing it across services multiplies the surface where it can be got wrong.

  

**Modules**, each owning its tables, exposing an interface, and forbidden from reaching into another's schema:

  

identity          registration, authentication, sessions, roles

  

brokers           individual profile, credentials, associations, attestations

  

businesses        entity, principals, affiliations, entity documents

  

relationships     links, consent, sharing scope, visibility resolution

  

accreditation     four-party records, authority chain, decisions, training

  

verification      check orchestration, provider adapters, reuse policy

  

evidence          immutable payloads, artefacts, hashing, retention

  

monitoring        due dates, scheduler, cadence rules, breach detection

  

lists             black list ingest and matching, grey list lifecycle

  

rulesets          per-lender configuration, versioning, evaluation

  

notifications     templating, delivery, preference, logging

  

metering          usage events, billing basis capture

  

audit             append-only event log, point-in-time queries

  

**The one thing worth extracting early** is the check worker pool — long-running, external-facing, bursty, and with a completely different scaling profile from request handling. Run it as separate processes against the same codebase and database. That is a deployment split, not a service split.

  

Revisit microservices when a specific module has a demonstrated scaling or team-autonomy problem. Not before.

  

## 20\. Data architecture

### 20.1 Primary store: PostgreSQL

One database. Postgres specifically, for reasons that matter here: row-level security as a defence-in-depth layer for tenancy, jsonb for provider payloads and ruleset configuration without schema churn, range types and exclusion constraints for temporal validity, LISTEN/NOTIFY and SELECT FOR UPDATE SKIP LOCKED for a job queue that needs no additional infrastructure.

  

Do not introduce a second datastore until something demonstrably doesn't fit. The temptation will be a document store for provider payloads — jsonb handles that.

### 20.2 Tenancy enforcement — two layers, both mandatory

**Layer one, application:** every query touching broker data goes through a single repository layer that requires an AuthorisationContext (actor, organisation, relationship set). There is no code path that reads broker data without one. Enforce with an architecture test that fails the build if a module imports the database driver directly.

  

**Layer two, database:** Postgres row-level security policies on every broker-scoped table, keyed on a session variable set per request. This exists to catch the developer who finds a way around layer one.

  

Belt and braces is proportionate here. A single missed WHERE clause exposes one lender's panel to another.

  

**Visibility resolution** is a first-class service, not an ad-hoc join. Given (actor, subject, data class) it returns permitted or not, applying: relationship exists and is active, client type scope (lender / aggregator / association per BRD 2.2), and data class rules. Every access is logged (AUD-007). One implementation, tested exhaustively, including the negative cases — a lender must not see another lender's relationship, and a grey list contributor must not be revealed where governance says otherwise.

### 20.3 Temporality — the decision that cannot be deferred

Point-in-time reconstruction (AUD-005) is not a reporting feature bolted on later. It is a property of how facts are stored.

  

**Rule: nothing that a lender might have relied on is ever updated in place.** Check results, statuses, documents, list entries and accreditation decisions are append-only with validity intervals:

  

check\_result

  

  id, subject\_id, check\_type, provider

  

  valid\_from timestamptz, valid\_to timestamptz   -- null = current

  

  outcome, evidence\_id

  

  superseded\_by uuid

  

Current state is a view (valid\_to IS NULL). Historical state is the same query with a timestamp predicate. Getting this right at the start costs a few days of design; retrofitting it costs a rewrite of every read path in the system.

  

Mutable-in-place is fine for genuinely current-only data: contact details, notification preferences, draft applications.

### 20.4 Evidence store

Provider payloads and artefacts go to object storage, not the database. Metadata, hashes and pointers in Postgres.

  

  - **Write-once.** Object lock / immutability policy at the bucket level, so immutability is enforced by infrastructure rather than by application discipline.
  - **Content-hashed at capture** (AUD-006), hash stored in Postgres, verified on retrieval.
  - **Retention 7 years** from capture or relationship end (NFR-PRV-4), with lifecycle rules moving aged objects to cold tiers. Cold retrieval latency is acceptable — nobody needs a 2027 register extract in 200ms.
  - **Scheduled deletion at expiry, audited** (NFR-AUD-5). Automatic, not manual.

  

Size this early. Full ID\&V payloads including document images, across a panel of thousands, held seven years, is a real cost line and one of the few places where this platform is expensive to run.

### 20.5 Audit log

Append-only table, written in the same transaction as the change it records. No separate audit service, no eventual consistency — an audit record that can be lost independently of the change is not an audit record.

  

Partition by month. Never update or delete within the retention window.

  

## 21\. Check orchestration

The most operationally demanding subsystem. Checks are slow, external, unreliable, occasionally expensive per call, and sometimes asynchronous over hours or days.

  

**Model every check as a job**, never a synchronous call in a request path:

  

requested → in\_flight → completed | failed | timed\_out

  

                ↓

  

        evidence written, result recorded, events emitted

  

**Provider adapters behind a common port.** Each external source implements the same interface: submit, poll or receive callback, normalise, and return the raw payload untouched alongside the normalised result. The raw payload is what gets stored as evidence (Section 2.4); the normalised result is a derived convenience and never a substitute.

  

Adapters live behind the interface so a second ID\&V provider (IDV-014) or a changed register API is an adapter change, not a system change.

  

**Queue:** Postgres-backed with SKIP LOCKED to start. It handles far more throughput than this platform will generate for years, and it keeps job state in the same transaction as domain state. Move to a dedicated broker only when there is evidence of need.

  

**Per-provider rate limiting and circuit breaking.** External registers will throttle or fall over. A monitoring sweep that hammers a regulator's endpoint is both an outage and a relationship problem.

  

**Reuse policy at the orchestration layer, not the caller.** Before dispatching, the orchestrator asks: is there a current result for this subject and check type that this client may use? Per Section 7.3 — live-source checks are governed by monitoring cadence, point-in-time checks by validity window, client-internal checks never reused. Callers should not be able to bypass this.

  

## 22\. Monitoring engine

The differentiating feature and the one with the least obvious implementation.

  

**Do not schedule per broker.** A cron job per broker per check type does not scale and cannot be reasoned about.

  

**Do use a due-date ledger.** One table of monitoring items, each with a next-due timestamp:

  

monitoring\_item

  

  subject\_id, subject\_type (broker | business | chain | membership)

  

  item\_type, cadence\_rule\_id

  

  next\_due\_at, last\_evaluated\_at, status

  

A single worker sweeps next\_due\_at \<= now() in batches, dispatches checks, and recomputes the next due date. This gives even load, natural batching, and a trivially inspectable answer to "what is due and when".

  

**Cadence is resolved per relationship, not per broker.** Where two lenders want a licence re-checked at different frequencies, the platform runs the tighter one and both see the result — a live-source check is a shared fact, not a per-lender artefact. Only client-internal checks run per client.

  

**Jitter due dates** so a cohort onboarded on the same day does not re-check on the same day forever.

  

**Event emission is where the value lands.** A check completing produces domain events — credential\_expired, chain\_broken, blacklist\_matched, membership\_lapsed. Consumers: notification, ruleset evaluation, indicator recalculation, dashboard projections. In-process dispatch on the transaction commit hook, with the event persisted first so it survives a crash.

  

## 23\. Ruleset engine

Per-lender configuration is the difference between multi-tenant and single-tenant-with-extra-steps.

  

**Do not build a DSL or adopt a rules engine.** Both are traps: the DSL becomes a badly-specified programming language, and the rules engine becomes a system nobody can debug at 2am.

  

**Do use versioned declarative configuration** — JSON documents defining required documents with validity windows, required checks with acceptable reuse age, conditional rules (experience\_years \< 2 → mentoring\_letter\_required), thresholds (pi\_cover\_minimum by product scope), approval routing, training modules and deadlines, monitoring cadences, and event responses.

  

Evaluated by hand-written code against a fixed vocabulary of conditions. The vocabulary grows deliberately, by pull request, when a real lender needs something.

  

**Rulesets are versioned and immutable once used.** An accreditation records the ruleset version it was assessed against (OQ-6). Changing a ruleset creates a new version; existing accreditations are not retrospectively invalidated.

  

Ship with two seeded rulesets from day one — one modelled on the Westpac worked example, one deliberately different. If the second cannot be expressed without code changes, the abstraction is wrong and it is cheap to find out now.

  

## 24\. Integration posture

|  |  |  |
| :-: | :-: | :-: |
| \*\*Integration\*\* | \*\*Pattern\*\* | \*\*Notes\*\* |
| ID\&V provider | Adapter, async, callback | Raw payload is the evidence. Provider is replaceable by design |
| Business and corporate registers | Adapter, sync with cache | Cache with TTL aligned to monitoring cadence |
| Professional registers (licence, credit rep, corporate credit rep) | Adapter | The authority chain depends on these — highest reliability requirement |
| Credit bureau | Adapter, async | Per-call cost; reuse policy matters most here |
| Associations | Adapter \*\*plus manual fallback UI\*\* | Maturity varies from API to email. The manual path is a first-class feature, not a stopgap (ASN-010) |
| Black list sources | Scheduled ingest into a local matching index | Match locally; never round-trip per query |
| Lender systems of record | Adapter, outbound, per-lender | Do not build the first lender's integration into core |
| Lender evidence access | \*\*Pull, with download\*\* (OQ-18) | No push in MVP. Simplifies materially |
| E-signature, notifications | Standard providers | Unremarkable |

  

**Every external source needs a manual fallback.** Some association will have no API and no plans for one. A verification the platform cannot automate must still be capturable as a reviewer action with evidence, following the identical downstream path.

  

## 25\. Non-negotiables from day one

Cheap now, expensive or impossible later:

  

1.  **Metering events** (BIL-001). Emit from the first release even though billing automation is out of MVP. Backfilling usage history is impossible.
2.  **Temporal storage** (§20.3). A rewrite if deferred.
3.  **Authorisation context on every read** (§20.2). Retrofitting means auditing every query in the system.
4.  **Evidence immutability** (§20.4). Bucket-level object lock from the first upload.
5.  **Audit in-transaction** (§20.5). Gaps cannot be reconstructed.
6.  **Outcome capture for the risk indicator** (RSK-017). Whether or not the indicator ships, record the outcomes it would later need. Without it there is never enough history to calibrate.

  

## 26\. Delivery sequencing

Four releases. The ordering is driven by three constraints: the cold-start problem means monitoring must arrive early; the reliance assumption must be validated before the reuse economics are built on it; and the grey list is gated on a legal framework with a long lead time.

### Release 1 — Foundations and single-lender onboarding

*Goal: one lender accredits real brokers on the platform, end to end.*

  

  - Tenancy, authorisation context, visibility resolution, RLS
  - Identity, roles, client organisation onboarding
  - Broker profile and business onboarding, affiliation, sole trader journey
  - Document capture with validity rules
  - ID\&V integration, one provider
  - Core screening: registers, licence, credit representative, corporate credit representative, chain validation
  - Evidence store, temporal check results, audit log
  - Lender review workbench, decisioning, approval routing
  - Ruleset engine with two seeded configurations
  - Notifications, metering events

  

**Deliberately excluded:** monitoring, lists, indicator, aggregator and association portals, reuse across lenders.

  

**Proves:** the reliance assumption with a real lender, and that a second ruleset is expressible without code changes.

### Release 2 — Monitoring

*Goal: the lender from Release 1 gets continuous currency assurance over its panel.*

  

  - Monitoring item ledger, scheduler, cadence resolution
  - Document and credential expiry with reminder schedules
  - Source re-verification for licence, registers, chain, entity status
  - Business monitoring: registration, GST, solvency, principal changes
  - Broker attestation and change-of-circumstance reporting
  - Event emission, propagation and per-lender response rules
  - Monitoring dashboard, panel currency view, export

  

**Why second:** this is what is valuable to lender one before any network exists. It carries the commercial case through the cold-start period, and it exercises the check orchestration built in Release 1 at volume.

### Release 3 — Network: multi-lender and the black list

*Goal: the second and third lenders, and the reuse economics.*

  

  - Check reuse across relationships, with policy enforcement
  - Aggregator portal and full visibility scope
  - Association integration, membership confirmation, manual fallback
  - Black list: source ingest, matching, confirmation, cross-lender removal, delisting
  - Point-in-time evidence pack export
  - Broker multi-relationship experience
  - Transfer and party-change handling at volume

  

**Why third:** reuse has no value with one lender, and the black list needs external source access agreed (OQ-38) which has its own lead time.

### Release 4 — Grey list and indicator (gated)

*Goal: the consolidated concern register, once the governance framework exists.*

  

  - Grey list: contribution, evidence, broker notification and right of reply, expiry, withdrawal, dispute
  - Private lender assessment and watch lists
  - Conduct risk indicator, if it still earns its place (OQ-27)

  

**Hard gate:** does not start until the governance framework (OQ-41) and legal view (OQ-42) are agreed. This is the one release where engineering readiness is not the constraint.

  

**Note:** private lender assessment could move earlier — it is simple and carries no shared-data risk. It sits here only because it is most useful alongside the grey list.

### Sequencing summary

|  |  |  |
| :-: | :-: | :-: |
| \*\*Release\*\* | \*\*Theme\*\* | \*\*Gated on\*\* |
| 1 | Onboarding, verification, one lender | ID\&V provider selection (OQ-16) |
| 2 | Continuous monitoring | Nothing external |
| 3 | Network, reuse, black list | Black list source access (OQ-38) |
| 4 | Grey list, indicator | Governance framework and legal view (OQ-41/42) |

  

## 27\. What not to build

  - **Microservices.** §19.
  - **A rules DSL.** §23.
  - **Kafka or an event streaming platform.** The event volume here is thousands per day. Postgres and in-process dispatch are correct until proven otherwise.
  - **A custom identity provider.** Use an established one.
  - **Push integration into lender systems.** Pull with download is the agreed model (OQ-18) and is far less work.
  - **The risk indicator, yet.** Its input set thinned considerably when platform adjudication was removed. Capture the outcome data; defer the model.
  - **A generic document management system.** Typed documents with validity rules, not a file cabinet.

  

## 28\. Assumptions, and what would change the advice

This assumes a small team — roughly three to six engineers — building over twelve to eighteen months, with no existing platform to extend and no mandated enterprise stack.

  

What would change it:

  

  - **A much larger team** would tolerate more service separation, though the domain instability argument against it holds regardless.
  - **An existing stack or cloud mandate** changes the infrastructure specifics but not the data architecture, which is the part that matters.
  - **A hard near-term deadline for one lender** would argue for cutting Release 1 further — one ruleset instead of two, manual review instead of orchestrated checks — while keeping the six non-negotiables in §25 intact.
  - **Materially different volume assumptions** — hundreds of thousands of brokers rather than thousands — would change the queue and monitoring design, though not the storage model.

  

Worth confirming before the first sprint: team size and shape, timeline and any committed lender date, cloud and language preferences, and whether anyone in the team has run an append-only temporal model before. That last one is the highest-risk skill gap, because it is the decision that cannot be walked back.

  

# Annexes

## Annex A — Westpac worked example

Retained as the reference implementation from which requirements were derived. Useful for validating that the configurable model can express a real lender's process.

### A.1 Broker accreditation as currently performed

Application and document checklist received → administrator review → banned and disqualified check with screenshot retained → risk register / grey list check → details entered on a spreadsheet, uploaded to SharePoint, collected end of day, fraud/HR result returned by email the next business day → adverse results escalated to the Senior Manager, who classifies minor or material → decline routes back through the BDM, who informs the aggregator or broker → disputes route to an accreditation committee (GM Third Party, GM Consumer, Senior Manager Commercial) → approval path: BDM interviews the broker, details keyed into BBC and Broker7 with Pending status, details keyed into Savvy which triggers the training link → broker must complete training within **60 days** → on completion, product training date and business accreditation date recorded and status changed to Active → code of conduct, introducer number and commission details sent to the BDM, who forwards to the broker → certificate details sent for printing.

  

Broker Introducer and Referrer Introducer follow different paths; an individual cannot hold both.

### A.2 Transfer as currently performed

Documents emailed to a shared mailbox. Required: I/NET or MFAA transfer form signed by broker and aggregator; separation letter confirming no adverse circumstances; licence number. A drive folder is created as Surname\_FirstName\_yyyymmdd. The prior identifier is looked up in an Access database and must be active or active within the last 6 months. Cross-channel rules are checked manually: a commercial accreditation is permitted only under the same aggregator, and an individual cannot be both broker and referrer. A BDM is allocated from a postcode territory spreadsheet. Licence currency is confirmed on the regulator's register. A new identifier is provisioned by emailing a spreadsheet to an external provider, who creates the record and confirms by email; the result is then visually reconciled field by field. A welcome email is finally sent, with credentials copied from the confirmation email and the leading zero manually stripped from the BSB.

  

**This is the process the platform exists to eliminate.** Note particularly the plain-text credential handling — NFR-SEC-5 exists because of it.

### A.3 Illustrative client-specific configuration

|  |  |
| :-: | :-: |
| \*\*Configurable\*\* | \*\*Westpac value\*\* |
| Professional indemnity minimum | $2M commercial; $500K equipment finance |
| Police certificate validity | 6 months per procedure documents; 3 months per BRD v0.2 — an unresolved internal conflict, and a good example of why this is configurable |
| Training deadline | 60 days |
| Product scopes | Consumer, Commercial, Equipment Finance |
| Approval routing | National Manager Commercial / State Manager Equipment Finance / National GM Consumer, plus Equipment Finance Credit Manager sign-off |
| Escalation | Senior Manager, then accreditation committee |
| Client-specific checks | Internal risk register / grey list, internal fraud and HR screening |
| Additional obligation | AML/CTF risk assessment and Financial Intelligence Unit rating for equipment finance |
| Systems of record | BBC (commercial, equipment finance), Broker7 (consumer), THLP (referrer), Savvy (training), GOE (identifiers) |

### A.4 Commission schedule (reference document only)

Surfaced in the onboarding pack; not calculated by the platform. Source: Westpac Commercial Introducer Broker Commission Rates, August 2020, effective 21 January 2019. Rates are negotiated up to the stated maxima.

  

|  |  |  |
| :-: | :-: | :-: |
| \*\*Tier / product\*\* | \*\*Upfront (up to)\*\* | \*\*Trail (up to)\*\* |
| ≤ $3m | 0.55% | 0.25% |
| \> $3m | 50% of establishment fee | 0.25% |
| Business Options Overdraft | 50% of establishment fee (cap $30,000) | Not applicable |
| Invoice Finance | 0.50% of take-up ledger (cap $20,000) | 0.25%, on average monthly balance |
| International Trade Finance | 50% of establishment fee (cap $30,000) | N/A |

  

Conditions include: commissions inclusive of GST; upfront cap on term lending the lower of 0.55% of exposure or $45,000; no trail caps; tier by total deal size; no commission where total deal size is under $50,000. Treat commission schedules as versioned, effective-dated documents per client — these rates are six years old and require revalidation.

  

## Annex B — Source documents

1.  Thriski Business Requirements Document v0.2, 22 Aug 2022
2.  Procedure Manual — Accreditation of Broker (Aggregator) (Third Party), Westpac
3.  Broker Onboarding process diagrams (Broker Introducer / Referrer Introducer; Aggregator), Westpac
4.  Transfer Requests procedure, Westpac
5.  Welcome emails to the broker procedure, Westpac
6.  Understanding your responsibilities as an Introducer / Broker Code of Conduct, Oct 2015, Westpac
7.  Commercial Introducer Broker Commission Rates, August 2020, Westpac
8.  Broker requirements data and activity list (spreadsheet)
9.  Westpac Group Commercial Accreditation — New and Transfer form (Multibrand), v1.2, 26 Feb 2023
10.  BOQ Commercial Accreditation form, April 2025
11.  NAB Commercial Broker Accreditation Form, June 2025 (short form — existing NAB residential brokers)
12.  NAB Commercial Broker Stand Alone Commercial and/or Equipment Finance Accreditation Form, June 2025
13.  Maple Asset Finance — Introducer Accreditation Form (MCF1.01) and Broker Firm Accreditation Form (MCF1.02)
14.  Selfco Commercial Finance Application and Product Guide
15.  Firstmac Secured Asset accreditation correspondence
