/**
 * DOC-001's "required document types" — Section 14's document catalogue, scoped to
 * the general-purpose, non-accreditation-specific baseline (ONB-007/DOC-001: "what's
 * outstanding for your own profile/business," independent of any particular lender).
 *
 * This is deliberately NOT superseded by the ruleset engine (Epic 9) even though
 * Epic 9 now exists — accreditation.repository.ts's getOutstandingItems reads
 * per-accreditation requirements straight from a resolved ruleset's
 * requirementGroups (brand/role/productScope/pathway-specific, with any_of
 * document-or-association-membership alternatives), which is strictly richer than
 * this file for that context. The two mechanisms are intentionally disjoint: this
 * one stays the general baseline everywhere outside an accreditation's context, that
 * one is the per-lender variation on top of it. See accreditation.repository.ts's
 * own comment at getOutstandingItems for the other half of this split.
 *
 * Some of Section 14's 16 document types are deliberately NOT here:
 *   - Association membership certificate, external dispute resolution scheme
 *     membership (e.g. AFCA) — already represented structurally via the
 *     association_memberships table (ONB-006), not a raw document upload; AFCA is
 *     already one of the four association options there.
 *   - Credit report including bankruptcy — a system/bureau-fetched check result
 *     (Epic 7's screening catalogue, SCR-001), not something a broker uploads.
 *   - Separation/exit letter from previous aggregator, transfer form — required only
 *     for a Transfer-classified accreditation, i.e. exactly the kind of
 *     per-classification variation the ruleset engine models — these belong as
 *     requirementGroups on a Transfer ruleset variant, not this general catalog.
 *   - Client-specific forms — by definition not a fixed type; that's what the
 *     ruleset engine's own per-client configuration is for.
 */

export type DocumentSubjectType = 'broker_profile' | 'broker_business';

export type DocumentCatalogEntry = {
  documentType: string;
  label: string;
  subjectType: DocumentSubjectType;
  /** Default validity window in days from issue — null means "no expiry" (Section 14). */
  defaultValidityDays: number | null;
  /**
   * Only required when true — evaluated against the subject's own row by
   * getOutstandingDocumentItems. Absent entirely means "always required."
   */
  isRequired?: (subject: { experienceYears: number | null }) => boolean;
};

export const DOCUMENT_CATALOG: DocumentCatalogEntry[] = [
  {
    documentType: 'certificate_iv',
    label: 'Certificate IV in Finance and Mortgage Broking (or equivalent)',
    subjectType: 'broker_profile',
    defaultValidityDays: null,
  },
  {
    documentType: 'police_check',
    label: 'Police / criminal history certificate',
    subjectType: 'broker_profile',
    defaultValidityDays: 180, // Section 14: "3-12 months at submission" — 180 days is this platform's Release 1 default, client-configurable from Epic 9
  },
  {
    documentType: 'mentoring_letter',
    label: 'Mentoring confirmation letter',
    subjectType: 'broker_profile',
    defaultValidityDays: null,
    isRequired: (subject) => subject.experienceYears !== null && subject.experienceYears < 2, // ONB-012
  },
  {
    documentType: 'pi_certificate',
    label: 'Professional indemnity certificate of currency',
    subjectType: 'broker_business',
    defaultValidityDays: 365,
  },
  {
    documentType: 'diploma',
    label: 'Diploma or higher qualification',
    subjectType: 'broker_profile',
    defaultValidityDays: null,
    // Section 14: "Required by some clients" — not a Release-1 baseline requirement
    // on top of certificate_iv, but still a valid, uploadable document type so a
    // broker who holds one can attach it.
    isRequired: () => false,
  },
  {
    documentType: 'credit_licence_certificate',
    label: 'Credit licence or credit representative certificate',
    subjectType: 'broker_profile',
    defaultValidityDays: null, // Section 14: "Until varied"
  },
  {
    documentType: 'credit_licence_certificate',
    label: 'Credit licence or credit representative certificate',
    subjectType: 'broker_business',
    defaultValidityDays: null,
  },
  {
    documentType: 'financial_services_licence',
    label: 'Financial services licence / authorised representative certificate',
    subjectType: 'broker_business',
    defaultValidityDays: null,
    // Section 14: "Conditional on product scope" — product scope is an
    // accreditation-level concept (see this file's own header comment), not knowable
    // at the business level, so this can't be gated here. Uploadable, not required.
    isRequired: () => false,
  },
  {
    documentType: 'resume',
    label: 'Resume / work history',
    subjectType: 'broker_profile',
    defaultValidityDays: null, // Section 14: "Refresh on material change," not a fixed window
  },
  {
    documentType: 'right_to_work',
    label: 'Right-to-work / visa documentation',
    subjectType: 'broker_profile',
    defaultValidityDays: null,
    // Section 14: "Conditional" on visa status. broker_profiles.right_to_work_status
    // is free-text with no fixed enum and no frontend field collecting it yet, so
    // there's no reliable signal to gate on — uploadable, not required, until that
    // status is actually captured somewhere.
    isRequired: () => false,
  },
  {
    documentType: 'signed_declaration',
    label: 'Signed application or declaration',
    subjectType: 'broker_profile',
    defaultValidityDays: null,
  },
];

export function catalogForSubjectType(subjectType: DocumentSubjectType): DocumentCatalogEntry[] {
  return DOCUMENT_CATALOG.filter((entry) => entry.subjectType === subjectType);
}
