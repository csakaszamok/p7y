import crypto from 'node:crypto'

/**
 * Names for new sandboxes nobody named: six lower-case letters and digits, a letter first (k3x9q2). Lower case
 * because the name starts every app address (k3x9q2-web.<domain>) and DNS ignores case; about 1.5 billion of them,
 * so thousands of sandboxes almost never draw a taken one, and a taken one is drawn again.
 */

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const CHARS = `${LETTERS}0123456789`
export const GENERATED_NAME = /^[a-z][a-z0-9]{5}$/

/** One name; randomInt is crypto's (unbiased), given in tests. */
export function randomSandboxName(randomInt: (max: number) => number = crypto.randomInt): string {
  let name = LETTERS[randomInt(LETTERS.length)]
  for (let i = 1; i < 6; i++) name += CHARS[randomInt(CHARS.length)]
  return name
}

/** A name isFree accepts, or null when 64 draws found none. */
export function generateSandboxName(isFree: (name: string) => boolean, randomInt?: (max: number) => number): string | null {
  for (let i = 0; i < 64; i++) { const n = randomSandboxName(randomInt); if (isFree(n)) return n }
  return null
}
