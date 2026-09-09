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
  | 'accreditation_activated'
  | 'identity_verification_submitted'
  | 'identity_verification_complete'
  | 'identity_verification_queue_entry';

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  'profile_submitted',
  'business_submitted',
  'accreditation_queue_entry',
  'accreditation_information_required',
  'accreditation_approved',
  'accreditation_declined',
  'accreditation_activated',
  'identity_verification_submitted',
  'identity_verification_complete',
  'identity_verification_queue_entry',
];

// NOT-005: categories tied to a decision outcome the broker must not miss — cannot be
// disabled. Informational categories (submission confirmations, queue entry, the
// activation summary) are optional.
export const MANDATORY_NOTIFICATION_CATEGORIES = new Set<NotificationCategory>([
  'accreditation_information_required',
  'accreditation_approved',
  'accreditation_declined',
  'identity_verification_complete',
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

// IDV-*: identity/KYC (broker) and business/KYB verification notifications.
export function identityVerificationSubmittedTemplate(): NotificationContent {
  return {
    subject: 'Your identity verification has been submitted',
    body: 'We\'ll let you know once it\'s been reviewed.',
  };
}

export function identityVerificationCompleteTemplate(params: { approved: boolean }): NotificationContent {
  return params.approved
    ? { subject: 'Your identity verification is complete', body: 'Your identity has been verified.' }
    : {
        subject: 'Your identity verification needs attention',
        body: 'Your identity verification could not be confirmed as submitted. Please check your profile for details.',
      };
}

export function identityVerificationQueueEntryTemplate(params: { subjectName: string; kind: 'individual' | 'business' }): NotificationContent {
  return {
    subject: 'An identity verification result is ready for review',
    body: `${params.subjectName}'s ${params.kind === 'individual' ? 'identity' : 'business'} verification result is ready for your review.`,
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
