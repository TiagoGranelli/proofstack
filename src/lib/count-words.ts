/**
 * How many words `text` holds: runs of characters between whitespace. Punctuation stays part of its word, so
 * "don't" and "e-mail" count once each.
 *
 * @example countWords('  two words\n') // 2
 */
export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length
}
