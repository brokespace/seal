// Seal is a fork of Orca: user-visible copy says "Seal"; identifiers, file formats and upstream-compat paths keep "orca".

const LATIN_WORD = /[A-Za-z0-9_]/
// Paths, flags, headers, domains, env names and identifiers keep upstream spellings.
const NON_PROSE_PREFIX = /[A-Za-z0-9_./\\@#$~:=-]/
// Attribution keeps upstream's name on purpose.
const ATTRIBUTION_BEFORE =
  /(?:\bfork(?:ed)?\s+(?:of|from)|\bbased\s+on|\bupstream|\bcredit(?:s)?\s+to|\bthanks\s+to|\bGNOME['’]?s?)\s*\[?$/i
// GNOME Orca is the Linux screen reader, not this app; font family names are CSS identifiers; Discord/X links go to Orca's community.
const ATTRIBUTION_AFTER =
  /^\]?\s*(?:\(https:\/\/github\.com\/stablyai|\s+by\s+Stably|\s+authors\b|\s+screen\s+reader|\s+Nerd\s+Font|\s+Terminal\s+Symbols|\s+on\s+(?:Discord|X)\b)/i

// Commands a person types; agent-facing skill names and `orca` file formats stay upstream's.
const CLI_SUBCOMMANDS =
  'browser|worktree|environment|status|terminal|orchestration|emulator|serve|skills|commands?|cli|open|repo|login|logout|update|doctor|account|tab|pair|computer|first'
const CLI_COMMAND = new RegExp(`(?<![A-Za-z0-9_./\\\\~@:-])orca(?= (?:${CLI_SUBCOMMANDS})\\b)`, 'g')
const CLI_COMMAND_TOKEN = /`orca`/g

export const BRAND_ATTRIBUTION_ALLOWLIST = [
  /\bfork(?:ed)?\s+(?:of|from)\s+\[?Orca\b/i,
  /\bbased\s+on\s+\[?Orca\b/i,
  /\bupstream\s+Orca\b/i,
  /\bOrca\s+authors\b/i
]

// Prose compounds such as "non-Orca worktrees" or "Windows-Orca-CLI".
const PROSE_HYPHEN_PREFIX = /(?:^|[^A-Za-z])(?:non|Non|não|Windows)-$/

function isBrandMatch(text, index) {
  const before = text[index - 1]
  if (
    before !== undefined &&
    NON_PROSE_PREFIX.test(before) &&
    !PROSE_HYPHEN_PREFIX.test(text.slice(Math.max(0, index - 9), index))
  ) {
    return false
  }
  const after = text[index + 4]
  if (after === undefined) {
    return true
  }
  if (after === 's') {
    const next = text[index + 5]
    return next === undefined || !LATIN_WORD.test(next)
  }
  if (after === '-') {
    return /^-(?:\p{L}| (?:und|oder|et|ou|y|e|и|или)\s)/u.test(text.slice(index + 4, index + 10))
  }
  if (after === '.') {
    const rest = text.slice(index + 5)
    return !/^[A-Za-z0-9]/.test(rest) || /^(?:app|exe)\b/.test(rest)
  }
  return !LATIN_WORD.test(after)
}

/** Offsets of "Orca" used as the product name, excluding identifiers, paths and attribution. */
export function findBrandMentions(text) {
  const mentions = []
  for (let index = text.indexOf('Orca'); index !== -1; index = text.indexOf('Orca', index + 4)) {
    if (!isBrandMatch(text, index)) {
      continue
    }
    if (
      ATTRIBUTION_BEFORE.test(text.slice(Math.max(0, index - 40), index)) ||
      ATTRIBUTION_AFTER.test(text.slice(index + 4, index + 64))
    ) {
      continue
    }
    mentions.push(index)
  }
  return mentions
}

function replaceBrand(text) {
  const mentions = findBrandMentions(text)
  if (mentions.length === 0) {
    return text
  }
  let result = ''
  let cursor = 0
  for (const index of mentions) {
    result += `${text.slice(cursor, index)}Seal`
    cursor = index + 4
  }
  return result + text.slice(cursor)
}

const FRENCH_ELISION = /\b(d|l|qu|lorsqu|puisqu|jusqu|D|L|Qu|Lorsqu|Puisqu)['’](?=Orca)/g
// "Seal" reads /siːl/: front-vowel harmony after the apostrophe.
const TURKISH_SUFFIXES = new Map([
  ['nın', 'in'],
  ['nin', 'in'],
  ['yı', 'i'],
  ['yi', 'i'],
  ['ı', 'i'],
  ['ya', 'e'],
  ['ye', 'e'],
  ['da', 'de'],
  ['dan', 'den'],
  ['daki', 'deki'],
  ['dır', 'dir'],
  ['la', 'le'],
  ['yla', 'le']
])
const TURKISH_SUFFIX = /Seal(['’])(nın|nin|yı|yi|ı|ya|ye|daki|dan|da|dır|yla|la)(?![a-zçğıöşü])/g
// Batchim-final nouns take 이/을/은/과; ㄹ-final keeps 로.
const KOREAN_PARTICLES = new Map([
  ['가', '이'],
  ['를', '을'],
  ['는', '은'],
  ['와', '과'],
  ['라는', '이라는'],
  ['라고', '이라고'],
  ['야', '이야'],
  ['나', '이나'],
  ['랑', '이랑']
])
const KOREAN_PARTICLE = /Seal(라는|라고|가|를|는|와|야|나|랑)/g

// Translations move the command word around ("comandos orca", "orca コマンド"); bundled file names stay.
const LOCALIZED_CLI_COMMAND =
  /(?<![A-Za-z0-9_./\\~@:-])orca(?![A-Za-z0-9_/:]|\.[A-Za-z0-9]|-(?:ide|plugin|catalog|marketplace|linear|lineal|cli)\b)/g

/** For a translation whose English source renamed the `orca` command. */
export function rebrandLocalizedCommands(text) {
  return text.replace(LOCALIZED_CLI_COMMAND, 'seal')
}

const ANY_CLI_COMMAND = /(?<![A-Za-z0-9_./\\~@:$-])orca(?= (?:[a-z<[]|--?[a-z]))/g

/** For CLI help, where every lowercase `orca <word>` is the command. */
export function rebrandCliCommands(text) {
  return text.replace(ANY_CLI_COMMAND, 'seal').replace(CLI_COMMAND_TOKEN, '`seal`')
}

/** Rename only typed `orca <subcommand>` invocations; for code samples. */
export function rebrandCommands(text) {
  return text.replace(CLI_COMMAND, 'seal').replace(CLI_COMMAND_TOKEN, '`seal`')
}

function baseLocale(locale) {
  return (locale ?? 'en').split('-')[0]
}

/** Rebrand one user-visible string; `locale` adjusts grammar that depends on the name. */
export function rebrandCopy(text, { locale = 'en', commands = false } = {}) {
  let result = text
  const language = baseLocale(locale)
  if (language === 'fr') {
    result = result.replace(FRENCH_ELISION, (_, article) => `${article}e `)
  }
  result = replaceBrand(result)
  if (language === 'en') {
    result = result.replace(/\b([Aa])n Seal\b/g, '$1 Seal')
  }
  if (commands) {
    result = rebrandCommands(result)
  }
  if (language === 'tr') {
    result = result.replace(
      TURKISH_SUFFIX,
      (_, mark, suffix) => `Seal${mark}${TURKISH_SUFFIXES.get(suffix)}`
    )
  }
  if (language === 'ko') {
    result = result.replace(
      KOREAN_PARTICLE,
      (_, particle) => `Seal${KOREAN_PARTICLES.get(particle)}`
    )
  }
  return result
}
