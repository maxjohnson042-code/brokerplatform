/**
 * DOC-001's "required document types" — Section 14's full 14-row table, scoped down
 * to what's clearly Release-1/single-lender relevant, hardcoded until the ruleset
 * engine (Epic 9) exists to make this client-configurable. Same "hardcode the
 * Section-derived default until Epic 9" spirit Epic 3 already used for required
 * broker-profile fields. Extending this list later is additive, not a design change.
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
];

export function catalogForSubjectType(subjectType: DocumentSubjectType): DocumentCatalogEntry[] {
  return DOCUMENT_CATALOG.filter((entry) => entry.subjectType === subjectType);
}
