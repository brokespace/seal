const MASK = '••••'
const SECRET_NAME =
  /(token|secret|passw(?:or)?d|passphrase|credential|api[-_]?key|access[-_]?key|private[-_]?key)/i

/**
 * Process lists show full command lines, and those often carry tokens. Values of secret-named
 * flags and variables, bearer tokens, JWTs and URL passwords are masked before they leave main.
 */
export function maskCommandLineSecrets(commandLine: string): string {
  const words = commandLine.split(' ')
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    const assignment = /^(-{0,2}[A-Za-z][\w.-]*)=(.+)$/.exec(word)
    if (assignment && SECRET_NAME.test(assignment[1])) {
      words[i] = `${assignment[1]}=${MASK}`
    } else if (/^-{1,2}[A-Za-z]/.test(word) && SECRET_NAME.test(word) && i + 1 < words.length) {
      if (words[i + 1] && !words[i + 1].startsWith('-')) {
        words[i + 1] = MASK
        i += 1
      }
    } else if (/^bearer$/i.test(word) && words[i + 1]) {
      words[i + 1] = MASK
      i += 1
    }
  }
  return words
    .join(' ')
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g, MASK)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/gi, `$1:${MASK}@`)
}
