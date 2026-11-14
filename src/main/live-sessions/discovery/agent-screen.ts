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

export type AgentScreenApproval = {
  question: string
  options: { id: string; label: string; keys: string }[]
}

export type AgentScreen = {
  /** The input box is drawn: no dialog holds the terminal. */
  promptBox: boolean
  /** Text typed in the box but not sent. */
  draft: string
  approval: AgentScreenApproval | null
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
  for (const line of region.slice(questionAt + 1)) {
    const text = inner(line).replace(CURSOR, '')
    const m = OPTION.exec(text)
    if (m) {
      options.push({ id: m[1], label: m[2].replace(/\s*\((?:esc|[a-z])\)$/i, ''), keys: m[1] })
    } else if (options.length > 0 && text.trim() === '') {
      break
    }
  }
  if (options.length < 2) {
    return null
  }
  return { question: QUESTION.exec(inner(region[questionAt]))![1], options }
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
  return {
    promptBox: composer.box && approval === null,
    draft: composer.box ? composer.draft : '',
    approval
  }
}

export function screenAcceptsInput(screen: AgentScreen): boolean {
  return screen.promptBox && screen.draft === ''
}
