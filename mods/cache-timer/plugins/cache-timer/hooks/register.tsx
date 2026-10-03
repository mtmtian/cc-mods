import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, TurnUsage } from 'claude-code'

import type { Ttl } from '../types'

const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null)
const lastModel = atom({ plugin: 'cache-timer', key: 'lastModel' } as const, null)
const learnedTtl = atom({ plugin: 'cache-timer', key: 'learnedTtl' } as const, '1h')

const MINUTE = 60_000
const TTL_MS: Record<Ttl, number> = { '5m': 5 * MINUTE, '1h': 60 * MINUTE }
// A request this close past five minutes may still have caught a 5m entry.
const SLACK_MS = 15_000

export const label = (remainingMs: number): string => {
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
export const infer = (idleMs: number, usage: TurnUsage): Ttl | null => {
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
  const at = await read($, lastAt)
  if (at === null) {
    return null
  }
  const ttl = fixedTtl ?? (await read($, learnedTtl))

  return label(at + TTL_MS[ttl] - (await $.clock.now()))
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
      const at = (await $.clock.now()) - e.seconds_since_last_response * 1000
      await update($, lastAt, () => at)
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
    const previousAt = await read($, lastAt)
    const isSameModel = (await read($, lastModel)) === result.usage.model
    if (previousAt !== null && isSameModel) {
      const seen = infer(sentAt - previousAt, result.usage)
      if (seen !== null) {
        await update($, learnedTtl, () => seen)
      }
    }
    await update($, lastAt, () => sentAt)
    await update($, lastModel, () => result.usage?.model ?? null)
    $.ui.invalidate('ui.render')

    return result
  })
}
