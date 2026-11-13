/**
 * Lets any "Ask the agent" button send the user to the agent workspace and
 * put the cursor in the request box, optionally with a prepared request.
 */
const EVENT = 'tta:focus-composer';

let pending: { text?: string } | null = null;

export function requestComposerFocus(text?: string): void {
  pending = { text };
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Returns and clears a focus request made before the composer mounted. */
export function takePendingComposerRequest(): { text?: string } | null {
  const request = pending;
  pending = null;
  return request;
}

export function onComposerFocusRequest(handler: () => void): () => void {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
