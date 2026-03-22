/**
 * Simple CLI prompt helpers using Node.js built-in readline.
 * No external deps — can upgrade to @inquirer/prompts later if needed.
 */

import readline from 'readline'

// Handle Ctrl+C gracefully — close readline and exit
process.on('SIGINT', () => {
  closePrompts()
  console.log('\nAborted.')
  process.exit(130)
})

let rl: readline.Interface | null = null

function getRL(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
  }
  return rl
}

export function closePrompts(): void {
  if (rl) {
    rl.close()
    rl = null
  }
}

/** Ask a question with an optional default value. */
export function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : ''
  return new Promise((resolve) => {
    getRL().question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '')
    })
  })
}

/** Ask a yes/no question. */
export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N'
  const answer = await ask(`${question} [${hint}]`)
  if (!answer) return defaultYes
  return answer.toLowerCase().startsWith('y')
}

/** Ask the user to select from a numbered list. */
/** Print contextual guidance text (indented, stands out from prompts). */
export function info(text: string): void {
  for (const line of text.split('\n')) {
    console.log(`    ${line}`)
  }
}

/** Ask with validation + auto-correct re-ask. */
export async function askValidated(
  question: string,
  defaultValue: string | undefined,
  validate: (input: string) => { valid: boolean; message?: string; suggestion?: string },
): Promise<string> {
  const answer = await ask(question, defaultValue)
  const result = validate(answer)
  if (result.valid) return answer
  if (result.message) console.log(`    ${result.message}`)
  return ask(question, result.suggestion || defaultValue)
}

export async function select<T extends string>(
  question: string,
  options: Array<{ label: string; value: T; description?: string }>,
  defaultIndex = 0
): Promise<T> {
  console.log(`\n${question}`)
  for (let i = 0; i < options.length; i++) {
    const marker = i === defaultIndex ? '*' : ' '
    const desc = options[i].description ? ` — ${options[i].description}` : ''
    console.log(`  ${marker} ${i + 1}. ${options[i].label}${desc}`)
  }

  const answer = await ask(`Choice`, String(defaultIndex + 1))
  const idx = parseInt(answer, 10) - 1
  if (idx >= 0 && idx < options.length) {
    return options[idx].value
  }
  return options[defaultIndex].value
}
