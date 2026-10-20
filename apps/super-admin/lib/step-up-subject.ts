/**
 * The ONE normalisation of a step-up grant's subject (epic 22 retro F5). A grant is bound to (user, action, subject);
 * `issueStepUp` stores it and `consumeStepUp` looks it up by the same string, so both sides MUST normalise it the same
 * way or a grant issued for " New@Example.com " could never be consumed for "new@example.com". Both go through
 * this function, so no caller can drift. Lives here, not in a "use server" file, which may export only async actions.
 */
export function normalizeStepUpSubject(subject: string): string {
  return subject.trim().toLowerCase();
}
