// Epic 2 needs to send exactly one kind of email (AUTH-005 password reset) well before
// Epic 12's notification templating/delivery system exists. This is deliberately the
// minimum viable port for that — not a preview of Epic 12's design. Extend it there,
// don't grow it here.

export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

// Degrades gracefully when no provider is configured, same philosophy as the Sumsub
// adapter: the whole stack runs dev-side with zero cloud accounts. Logging the body
// also makes password-reset links copy-pasteable straight out of the dev console.
export class ConsoleEmailSender implements EmailSender {
  async send(to: string, subject: string, body: string): Promise<void> {
    console.log(`[email:console] to=${to} subject="${subject}"\n${body}`);
  }
}
