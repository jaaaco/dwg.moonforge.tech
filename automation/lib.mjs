/**
 * Shared helpers for the automation scripts.
 *
 * These run from cron, which means a stripped PATH, no shell profile and
 * nobody watching the terminal. So: absolute paths for every binary, and
 * anything worth knowing goes to Telegram rather than stdout.
 */

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const LOG_DIR = join(ROOT, 'automation/logs')
export const STATE_DIR = join(ROOT, 'automation/state')

/** Telegram credentials live with the bot that owns them, not in this repo. */
const TELEGRAM_ENV = '/Users/jaaaco/projects/lifeOS/telegram-bot/.env'

const readEnvValue = async (key) => {
  if (!existsSync(TELEGRAM_ENV)) return null
  const text = await readFile(TELEGRAM_ENV, 'utf8')
  const line = text.split('\n').find((row) => row.startsWith(`${key}=`))
  return line ? line.slice(key.length + 1).trim() : null
}

/**
 * Best-effort Telegram notification. Never throws: a broken notifier must not
 * take down the job it was reporting on.
 */
export const notify = async (text) => {
  try {
    const token = await readEnvValue('TELEGRAM_BOT_TOKEN')
    const chat = (await readEnvValue('OWNER_CHAT_ID'))?.split(',')[0]
    if (!token || !chat) return false

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10000),
    })
    return response.ok
  } catch {
    return false
  }
}

export const log = async (job, message) => {
  const stamp = new Date().toISOString()
  console.log(`[${job}] ${message}`)
  await mkdir(LOG_DIR, { recursive: true })
  await appendFile(join(LOG_DIR, `${job}.log`), `${stamp} ${message}\n`, 'utf8')
}

export const readState = async (name, fallback = {}) => {
  const path = join(STATE_DIR, `${name}.json`)
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

export const writeState = async (name, value) => {
  await mkdir(STATE_DIR, { recursive: true })
  await writeFile(join(STATE_DIR, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export const hasFlag = (name) => process.argv.includes(`--${name}`)

export const argOf = (name, fallback = null) => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
