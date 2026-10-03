import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { LastResponse, Ttl } from '../types'

const lastResponse = atom({ plugin: 'cache-timer', key: 'last' } as const, null)
const learnedTtl = atom({ plugin: 'cache-timer', key: 'learnedTtl' } as const, '1h')

const MINUTE = 60_000
const TTL_MS: Record<Ttl, number> = { '5m': 5 * MINUTE, '1h': 60 * MINUTE }
// A request this close past five minutes may still have caught a 5m entry.
const SLACK_MS = 15_000

const label = (remainingMs: number): string => {
  if (remainingMs <= 0) {
    return 'Cache cold'
  }
  const seconds = Math.ceil(remainingMs / 1000)
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return `Cache ${mm}:${ss}`
}

// What one main-thread response says about the lifetime: only a request sent
// 5 to 60 minutes after the previous one, on the same model, tells 5m from 1h.
const infer = (idleMs: number, usage: TurnUsage): Ttl | null => {
  const isTelling = idleMs > TTL_MS['5m'] + SLACK_MS && idleMs < TTL_MS['1h']
  if (!isTelling) {
    return null
  }
  if (usage.cache_read_input_tokens > 0) {
    return '1h'
  }

  return usage.cache_creation_input_tokens > 0 ? '5m' : null
}

async function shown($: EngineInterface, fixedTtl: Ttl | null): Promise<string | null> {
  const last = await read($, lastResponse)
  if (last === null) {
    return null
  }
  const ttl = fixedTtl ?? (await read($, learnedTtl))

  return label(last.at + TTL_MS[ttl] - (await $.clock.now()))
}

export const register: Register = (on, options) => {
  const fixedTtl: Ttl | null = options.ttl === '1h' || options.ttl === '5m' ? options.ttl : null

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    $.clock.every(1000, () => $.ui.invalidate('ui.render'))

    return started
  })

  // A dim label at the head of the footer's mode chip, left of the model. A
  // tree of its own: the desktop draws the chip from the props it holds, so a
  // rewritten `modes` never reaches its screen; the status line would prefix
  // the plugin's name.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const text = await shown($, fixedTtl)
    if (text === null) {
      return next(e)
    }
    const { Box, Text } = $.ui.resolve(e)
    // other mods add to the chip beneath us; keep what they drew
    const below = await next(e)

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text dimColor>{text}</Text>
        {below}
      </Box>
    )
  })

  // A resumed transcript's cache is as old as its last response.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.seconds_since_last_response !== undefined) {
      const resumed: LastResponse = { at: (await $.clock.now()) - e.seconds_since_last_response * 1000, model: null }
      await update($, lastResponse, () => resumed)
      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  // The one place the engine names the lifetime outright.
  on('classic.PostModelSwitch', async ($, e, next) => {
    await update($, learnedTtl, () => e.cache_ttl)
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const sentAt = await $.clock.now()
    const result = yield* next(e)

    // Subagents keep caches of their own; only the main thread's is timed.
    if (e.agentId !== undefined || result.usage === null) {
      return result
    }
    const previous = await read($, lastResponse)
    if (previous !== null && previous.model === result.usage.model) {
      const seen = infer(sentAt - previous.at, result.usage)
      if (seen !== null) {
        await update($, learnedTtl, () => seen)
      }
    }
    const last: LastResponse = { at: sentAt, model: result.usage.model }
    await update($, lastResponse, () => last)
    $.ui.invalidate('ui.render')

    return result
  })
}
