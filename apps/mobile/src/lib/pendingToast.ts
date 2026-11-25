// A one-shot message handed from a screen that closes (the /goal sheet) to the screen underneath (Profile), which shows it as a toast the next
// time it takes focus. A module-level cell: the two screens never mount together on the same stack entry, and the message must survive the
// closing screen unmounting.
let pending: string | null = null;

export function setPendingToast(message: string): void {
  pending = message;
}

/** Returns the waiting message once and clears it. */
export function consumePendingToast(): string | null {
  const message = pending;
  pending = null;
  return message;
}
