/**
 * Mirrors src/modules/evidence/document-catalog.ts's labels/required-by-default
 * flags — there's no endpoint exposing the backend catalog, so this is duplicated
 * client-side deliberately, the same way other small enum-to-label maps in this app
 * are (e.g. relationships-view.tsx's TYPE_LABELS). Keep in sync by hand; it's a
 * handful of entries that change rarely, not worth an API round-trip for.
 */
export type DocumentCatalogEntry = {
  documentType: string;
  label: string;
  /** "conditional" means: only actually required for some brokers — see profile-view.tsx's use for mentoring_letter. */
  required: boolean | "conditional";
};

export const PROFILE_DOCUMENT_CATALOG: DocumentCatalogEntry[] = [
  { documentType: "certificate_iv", label: "Certificate IV in Finance and Mortgage Broking (or equivalent)", required: true },
  { documentType: "police_check", label: "Police / criminal history certificate", required: true },
  { documentType: "mentoring_letter", label: "Mentoring confirmation letter", required: "conditional" },
  { documentType: "credit_licence_certificate", label: "Credit licence or credit representative certificate", required: true },
  { documentType: "resume", label: "Resume / work history", required: true },
  { documentType: "signed_declaration", label: "Signed application or declaration", required: true },
  { documentType: "diploma", label: "Diploma or higher qualification", required: false },
  { documentType: "right_to_work", label: "Right-to-work / visa documentation", required: false },
];

export const BUSINESS_DOCUMENT_CATALOG: DocumentCatalogEntry[] = [
  { documentType: "pi_certificate", label: "Professional indemnity certificate of currency", required: true },
  { documentType: "credit_licence_certificate", label: "Credit licence or credit representative certificate", required: true },
  { documentType: "financial_services_licence", label: "Financial services licence / authorised representative certificate", required: false },
];
