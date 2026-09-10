// Small date-to-label helpers shared by the review queue and the lender's-point-of-view
// broker profile page — both need "how long has this been waiting" and "how urgent is
// this deadline" phrased the same way so a reviewer sees consistent language wherever
// they're triaging.

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function requestedAgoLabel(requestedAt: string): string {
  const days = daysSince(requestedAt);
  if (days <= 0) return "Requested today";
  if (days === 1) return "Requested 1 day ago";
  return `Requested ${days} days ago`;
}

export function trainingDeadlineLabel(deadline: string): { label: string; overdue: boolean } {
  const days = daysUntil(deadline);
  if (days < 0) return { label: `Training overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"}`, overdue: true };
  if (days === 0) return { label: "Training due today", overdue: true };
  return { label: `Training due in ${days} day${days === 1 ? "" : "s"}`, overdue: days <= 7 };
}

export function documentExpiryLabel(expiryDate: string): { label: string; overdue: boolean } {
  const days = daysUntil(expiryDate);
  if (days < 0) return { label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`, overdue: true };
  if (days === 0) return { label: "Expires today", overdue: true };
  return { label: `Expires in ${days} day${days === 1 ? "" : "s"}`, overdue: days <= 30 };
}
