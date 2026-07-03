/**
 * Sanitize untrusted prompt input for safe injection into XML-delimited system prompt.
 * Prevents prompt injection via XML delimiter breaking.
 */
export function sanitizePromptLayer(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')     // Strip XML tags
    .replace(/&/g, '&amp;')     // Escape ampersand first
    .replace(/</g, '&lt;')      // Escape less-than
    .replace(/>/g, '&gt;');     // Escape greater-than
}
