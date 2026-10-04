import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, TurnUsage } from 'claude-code'

const MINUTE = 60_000
const T0 = 1_000_000_000

const warm = (model = 'claude-opus-5-5'): TurnUsage => ({
  model,
  input_tokens: 10,
  output_tokens: 50,
  cache_read_input_tokens: 40_000,
  cache_creation_input_tokens: 300,
})

const cold = (model = 'claude-opus-5-5'): TurnUsage => ({
  model,
  input_tokens: 10,
  output_tokens: 50,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 40_300,
})

// Stands in for the engine beneath the plugin: the clock, the footer's mode
// labels, session start, and a model step that answers with the usage it is handed.
const world = (on: On) => {
  const clock = mock.clock(on, { now: T0 })
  let redraws = 0
  let usage: TurnUsage | null = null
  on('ui.invalidate', () => {
    redraws += 1
    return { value: undefined }
  })
  // the engine's own chip, which the mod must keep drawing beside its label
  on('ui.render', { component: 'SessionMode' }, () => ({ type: 'Text', props: {}, children: ['native'] }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage }
  })
  const step = async ($: Engine, next: TurnUsage | null, agentId?: string) => {
    usage = next
    const stream = $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 2, ...(agentId ? { agentId } : {}) })
    for await (const _ of stream) {
      // drain
    }
    await stream.result
  }
  const start = ($: Engine) => $.session.start({ cwd: '/w', surface: 'desktop', isInteractive: true })
  // The footer chip as drawn on the desktop, flattened to its texts in order.
  const footer = async ($: Engine) => {
    const tree = await $.ui.render({ component: 'SessionMode', surface: 'desktop', requestId: 'session-mode', props: { modes: [] } })
    const texts: string[] = []
    const walk = (n: unknown): void => {
      if (typeof n === 'string') texts.push(n)
      else if (Array.isArray(n)) n.forEach(walk)
      else if (n && typeof n === 'object' && 'children' in n) walk((n as { children: unknown }).children)
    }
    walk(tree)
    return texts
  }
  const shown = async ($: Engine) => (await footer($)).find(t => t.startsWith('Cache'))

  return { clock, step, start, footer, shown, redraws: () => redraws }
}

test('shows nothing before the first response', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.clock.advance(3000)

  expect(await w.shown($)).toBe(undefined)
})

test('counts down an hour from the request and goes cold after it', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.step($, warm())
  expect(await w.shown($)).toBe('Cache 60:00')

  await w.clock.advance(11_000)
  expect(await w.shown($)).toBe('Cache 59:49')

  await w.clock.advance(60 * MINUTE)
  expect(await w.shown($)).toBe('Cache cold')
})

test('a subagent request leaves the main timer alone', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.step($, warm(), 'agent-1')
  await w.clock.advance(1000)

  expect(await w.shown($)).toBe(undefined)
})

test('a request with no response does not restart the timer', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.step($, warm())
  await w.clock.advance(10 * MINUTE)
  await w.step($, null)
  await w.clock.advance(1000)

  expect(await w.shown($)).toBe('Cache 49:59')
})

test('auto: a miss after ten idle minutes switches to 5m', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.step($, warm())
  await w.clock.advance(10 * MINUTE)
  await w.step($, cold())

  expect(await w.shown($)).toBe('Cache 05:00')
})

test('auto: a hit after ten idle minutes keeps 1h', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.step($, warm())
  await w.clock.advance(10 * MINUTE)
  await w.step($, warm())

  expect(await w.shown($)).toBe('Cache 60:00')
})

test('auto: a miss on a different model says nothing about the lifetime', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.step($, warm('claude-opus-5-5'))
  await w.clock.advance(10 * MINUTE)
  await w.step($, cold('claude-sonnet-5-5'))

  expect(await w.shown($)).toBe('Cache 60:00')
})

test('the 5m option counts down five minutes', { options: { ttl: '5m' } }, async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.step($, warm())
  await w.clock.advance(4 * MINUTE)

  expect(await w.shown($)).toBe('Cache 01:00')
})

test('a resumed session starts from its last response', async ($, on) => {
  const w = world(on)
  await w.start($)
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 600 })

  expect(await w.shown($)).toBe('Cache 50:00')
})

test('draws its label before the native chip and redraws every second', async ($, on) => {
  const w = world(on)
  await w.start($)
  await w.step($, warm())
  expect(await w.footer($)).toEqual(['Cache 60:00', 'native'])

  const before = w.redraws()
  await w.clock.advance(3025)
  expect(w.redraws() - before).toBe(3)
})

// plan-progress redraws its band 25 ms past each wall-clock second; landing on
// the same instant keeps its once-a-second loops from being restarted mid-way
test('redraws just after each wall-clock second, wherever the session started', async ($, on) => {
  const w = world(on)
  await w.clock.advance(400)
  await w.start($)
  await w.step($, warm())

  const before = w.redraws()
  await w.clock.advance(624)
  expect(w.redraws() - before).toBe(0)
  await w.clock.advance(1)
  expect(w.redraws() - before).toBe(1)
  await w.clock.advance(1000)
  expect(w.redraws() - before).toBe(2)
})

test('steps once a second from a response off the second, and never above the lifetime', async ($, on) => {
  const w = world(on)
  await w.clock.advance(400)
  await w.start($)
  await w.step($, warm())
  expect(await w.shown($)).toBe('Cache 60:00')

  await w.clock.advance(625)
  expect(await w.shown($)).toBe('Cache 59:59')
  await w.clock.advance(1000)
  expect(await w.shown($)).toBe('Cache 59:58')
})

test('leaves the footer untouched before the first response', async ($, on) => {
  const w = world(on)
  await w.start($)

  expect(await w.footer($)).toEqual(['native'])
})
