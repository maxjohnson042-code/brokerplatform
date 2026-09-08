/**
 * NOT-*: one place for every notification category's subject/body — replacing the
 * three hardcoded strings that used to live directly in accreditation.controller.ts.
 * The vocabulary grows deliberately, by pull request, same "fixed vocabulary, no DSL"
 * precedent as the ruleset condition grammar (Section 23).
 */

export type NotificationCategory =
  | 'profile_submitted'
  | 'business_submitted'
  | 'accreditation_queue_entry'
  | 'accreditation_information_required'
  | 'accreditation_approved'
  | 'accreditation_declined'
  | 'accreditation_activated';

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'profile_submitted',
  'business_submitted',
  'accreditation_queue_entry',
  'accreditation_information_required',
  'accreditation_approved',
  'accreditation_declined',
  'accreditation_activated',
];

// NOT-005: categories tied to a decision outcome the broker must not miss — cannot be
// disabled. Informational categories (submission confirmations, queue entry, the
// activation summary) are optional.
export const MANDATORY_NOTIFICATION_CATEGORIES = new Set<NotificationCategory>([
  'accreditation_information_required',
  'accreditation_approved',
  'accreditation_declined',
]);

export type NotificationContent = { subject: string; body: string };

export function profileSubmittedTemplate(): NotificationContent {
  return {
    subject: 'Your profile has been submitted',
    body: 'Your profile has been submitted for review. We\'ll let you know if anything else is needed.',
  };
}

export function businessSubmittedTemplate(): NotificationContent {
  return {
    subject: 'Your business has been submitted',
    body: 'Your business has been submitted for verification. We\'ll let you know if anything else is needed.',
  };
}

export function accreditationQueueEntryTemplate(params: { brokerName: string; classification: string }): NotificationContent {
  return {
    subject: 'A new accreditation request is in your queue',
    body: `${params.brokerName} has requested accreditation (${params.classification.replace(/_/g, ' ')}). It's now in your review queue.`,
  };
}

export function accreditationInformationRequiredTemplate(params: { itemisedReasons: string[] }): NotificationContent {
  return {
    subject: 'More information needed for your accreditation',
    body: params.itemisedReasons.join('\n'),
  };
}

export function accreditationApprovedTemplate(): NotificationContent {
  return {
    subject: 'Your accreditation has been approved',
    body: 'Training details will follow shortly.',
  };
}

export function accreditationDeclinedTemplate(params: { rationale: string }): NotificationContent {
  return {
    subject: 'Your accreditation was not approved',
    body: params.rationale,
  };
}

export function accreditationActivatedTemplate(params: { organisationName: string; lenderIssuedId: string | null }): NotificationContent {
  return {
    subject: 'Your accreditation is now active',
    body: [
      `Your accreditation with ${params.organisationName} is now active.`,
      params.lenderIssuedId ? `Your accreditation ID: ${params.lenderIssuedId}.` : null,
      'Full onboarding details (code of conduct, commission schedule, access details) will follow from your relationship manager.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
