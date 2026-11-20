// Reads what a Claude Code / Codex TUI shows from `tmux capture-pane -e` text.
// Main-process bundles stay ASCII, so the TUI's glyphs are written as escapes.

const PROMPT_MARKS = ['\u276f', '\u203a', '>'] // Claude's ❯, Codex's ›
const RULE = '\u2500'
const BOX_SIDE = /^[\s\u2502\u2503|]*/
const BOX_END = /[\s\u2502\u2503|]*$/
const CURSOR = /^(?:\u276f|\u203a|>)\s*/
const OPTION = /^(\d)\.\s+(.+?)\s*$/
const QUESTION =
  /(Do you want to [^?]*\?|Would you like to [^?]*\?|Allow [^?]*\?|Approve [^?]*\?|Proceed\?)/
/** The key hints a dialog draws under its choices. */
const DIALOG_HINT = /\b(esc to cancel|enter to (confirm|select|continue))\b/i
const BUSY_HINT = /\besc to interrupt\b/i
const FOOTER_LINES = 10
const DIALOG_LINES = 40

export type AgentScreenApproval = {
  question: string
  /** Empty when the dialog lists its choices without digits: it is answered in the terminal. */
  options: { id: string; label: string; keys: string }[]
}

export type AgentScreen = {
  /** The input box is drawn: no dialog holds the terminal. */
  promptBox: boolean
  /** Text typed in the box but not sent. */
  draft: string
  approval: AgentScreenApproval | null
  /** A dialog other than a recognized approval holds the terminal; its first line. */
  dialog: string | null
  /** The agent shows its interrupt hint: a turn is running. */
  busy: boolean
}

/** Strip escapes: `shown` is the visible text, `typed` the same without dim (hint) text. */
export function unstyleLine(line: string): { shown: string; typed: string } {
  let shown = ''
  let typed = ''
  let dim = false
  for (let i = 0; i < line.length;) {
    const c = line.charCodeAt(i)
    if (c === 0x1b && line[i + 1] === '[') {
      let j = i + 2
      while (j < line.length && (line.charCodeAt(j) < 0x40 || line.charCodeAt(j) > 0x7e)) {
        j++
      }
      if (line[j] === 'm') {
        for (const p of line.slice(i + 2, j).split(';')) {
          if (p === '2') {
            dim = true
          } else if (p === '' || p === '0' || p === '22') {
            dim = false
          }
        }
      }
      i = j + 1
      continue
    }
    if (c === 0x1b) {
      i += 2
      continue
    }
    const ch = String.fromCodePoint(line.codePointAt(i)!)
    shown += ch
    if (!dim) {
      typed += ch
    }
    i += ch.length
  }
  return { shown, typed }
}

function isRule(line: string): boolean {
  const s = line.trim()
  return s.length >= 10 && [...s].every((ch) => ch === RULE)
}

function inner(line: string): string {
  return line.replace(BOX_SIDE, '').replace(BOX_END, '')
}

function readApproval(lines: string[]): AgentScreenApproval | null {
  const region = lines.slice(-40)
  const questionAt = region.findLastIndex((line) => QUESTION.test(inner(line)))
  if (questionAt === -1) {
    return null
  }
  const options: AgentScreenApproval['options'] = []
  let labelColumn = -1
  for (const line of region.slice(questionAt + 1)) {
    const text = inner(line).replace(CURSOR, '')
    const m = OPTION.exec(text)
    const last = options.at(-1)
    // Columns as drawn, a dialog's left border blanked so indents compare.
    const drawn = line.replace(/^(\s*)[\u2502\u2503|]/, '$1 ')
    if (m) {
      options.push({ id: m[1], label: m[2].replace(/\s*\((?:esc|[a-z])\)$/i, ''), keys: m[1] })
      labelColumn = drawn.indexOf(m[2])
    } else if (options.length > 0 && text.trim() === '') {
      break
    } else if (last && labelColumn > 0 && drawn.search(/\S/) >= labelColumn) {
      // A long label wraps onto lines indented under its first.
      last.label = `${last.label} ${text.trim()}`
    }
  }
  const question = QUESTION.exec(inner(region[questionAt]))![1]
  if (options.length >= 2) {
    return { question, options }
  }
  // Choices without digits ("❯ No" / "Yes") are picked with the arrow keys.
  const choices = region.slice(questionAt + 1).map(inner)
  const end = choices.findIndex((line) => line.trim() === '' || DIALOG_HINT.test(line))
  const listed = (end === -1 ? choices : choices.slice(0, end)).filter((line) => line.trim())
  return listed.length >= 2 && listed.some((line) => CURSOR.test(line))
    ? { question, options: [] }
    : null
}

/** The first line of a dialog that holds the terminal: what stands under the rule it opens with. */
function readDialog(shown: string[]): string | null {
  if (!shown.slice(-FOOTER_LINES).some((line) => DIALOG_HINT.test(line))) {
    return null
  }
  const region = shown.slice(-DIALOG_LINES)
  const title = region
    .slice(region.findIndex(isRule) + 1)
    .map((line) => inner(line).trim())
    .find((line) => line.length > 0 && !isRule(line) && !DIALOG_HINT.test(line))
  return title ?? 'A dialog is open in the terminal'
}

/** The bottom-most prompt box: a rule, lines starting with the prompt mark, a rule. */
function readPromptBox(shown: string[], typed: string[]): { box: boolean; draft: string } {
  for (let end = shown.length - 1; end > 0; end--) {
    if (!isRule(shown[end])) {
      continue
    }
    let start = -1
    for (let j = end - 1; j >= 0 && end - j <= 40; j--) {
      if (isRule(shown[j])) {
        start = j
        break
      }
    }
    if (start < 0 || start + 1 >= end) {
      continue
    }
    const firstShown = inner(shown[start + 1])
    const mark = PROMPT_MARKS.find((m) => firstShown.startsWith(m))
    if (!mark) {
      continue
    }
    const first = inner(typed[start + 1])
    const body = [first.startsWith(mark) ? first.slice(mark.length) : first]
    body.push(...typed.slice(start + 2, end).map(inner))
    return { box: true, draft: body.join('\n').replace(/^[\s\u00a0]+|[\s\u00a0]+$/g, '') }
  }
  return { box: false, draft: '' }
}

/** Codex draws its composer without rules: the last `›` line under the transcript. */
function readBareComposer(shown: string[], typed: string[]): { box: boolean; draft: string } {
  for (let i = shown.length - 1; i >= Math.max(0, shown.length - 8); i--) {
    const line = shown[i].trimStart()
    if (line.startsWith('\u203a')) {
      const t = typed[i].trimStart()
      return { box: true, draft: (t.startsWith('\u203a') ? t.slice(1) : t).trim() }
    }
  }
  return { box: false, draft: '' }
}

export function parseAgentScreen(text: string): AgentScreen {
  const raw = text.replace(/\n+$/, '').split('\n')
  const shown: string[] = []
  const typed: string[] = []
  for (const line of raw) {
    const u = unstyleLine(line)
    shown.push(u.shown)
    typed.push(u.typed)
  }
  const approval = readApproval(shown)
  const prompt = readPromptBox(shown, typed)
  const composer = prompt.box ? prompt : readBareComposer(shown, typed)
  const promptBox = composer.box && approval === null
  return {
    promptBox,
    draft: composer.box ? composer.draft : '',
    approval,
    dialog: promptBox || approval !== null ? null : readDialog(shown),
    busy: shown.slice(-FOOTER_LINES).some((line) => BUSY_HINT.test(line))
  }
}

export function screenAcceptsInput(screen: AgentScreen): boolean {
  return screen.promptBox && screen.draft === ''
}
