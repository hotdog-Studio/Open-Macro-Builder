/** The message of what a step threw or rejected with: an error's message, a thrown text as it is. */
export function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return typeof cause === 'string' ? cause : 'An unknown error.'
}

/** `message` without a final full stop, for a sentence that goes on after it. */
export const withoutFullStop = (message: string) => message.replace(/\.$/, '')
