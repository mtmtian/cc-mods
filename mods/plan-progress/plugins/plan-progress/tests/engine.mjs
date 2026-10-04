// a stand-in engine around the real, compiled register.tsx: hooks run as written, only $ is faked
globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })
// cc-mods: the terminal Raster packs its cells with Uint8Array#toBase64, which the engine's Bun has and Node before 25 lacks
if (!Uint8Array.prototype.toBase64) {
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    value() {
      return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64')
    },
  })
}

export const TOOL = 'mcp__plan-progress__plan_progress'

export async function boot(file, kept = new Map()) {
  // a fresh module instance per scenario, so its module-level maps start empty
  const mod = await import(new URL(file, import.meta.url).href + '?n=' + Math.random())
  const hooks = []
  mod.register((event, a, b) => hooks.push(b ? { event, matcher: a, fn: b } : { event, matcher: null, fn: a }), {})

  const state = new Map()
  let now = 1_000_000
  const timers = []
  const every = []
  const sounds = []
  let toolSpec = null
  const blits = []
  const $ = {
    __get(a) {
      return state.has(a.ref.key) ? state.get(a.ref.key) : a.initial
    },
    __update(a, fn) {
      const v = fn(this.__get(a))
      state.set(a.ref.key, v)
      return v
    },
    clock: { now: async () => now, after: (ms, cb) => void timers.push({ at: now + ms, cb }), every: (ms, cb) => {
        const t = { ms, cb, isOn: true }
        every.push(t)
        return { cancel: () => void (t.isOn = false) }
      },
    },
    // the plugin's store outlives a boot when the caller passes the same map, as it outlives a restart
    store: {
      get: async k => (kept.has(k) ? JSON.parse(kept.get(k)) : undefined),
      set: async (k, v) => void kept.set(k, JSON.stringify(v)),
      delete: async k => void kept.delete(k),
      keys: async () => [...kept.keys()],
    },
    session: { id: async () => 'session-1' },
    audio: { play: async ({ asset }) => void sounds.push(asset) },
    process: { run: async () => ({}) },
    plugin: { root: '/plugin' },
    tool: { register: async spec => void (toolSpec = spec) },
    command: { register: async () => {} },
    config: { list: async () => [] },
    ui: {
      resolve: e => (e?.surface === 'terminal' ? { Box: 'Box', Button: 'Button', Text: 'Text', Raster: 'Raster' } : { Box: 'Box', Button: 'Button', Text: 'Text', Svg: 'Svg' }),
      toast: () => {},
      blit: async args => {
        blits.push(args)
        return {}
      },
    },
  }
  const matches = (m, e) => !m || Object.entries(m).every(([k, v]) => e[k] === v)
  const dispatch = (event, e, core) => {
    const chain = hooks.filter(h => h.event === event && matches(h.matcher, e))
    const run = (i, ev) => (i < chain.length ? chain[i].fn($, ev, ev2 => run(i + 1, ev2)) : Promise.resolve(core(ev)))
    return run(0, e)
  }

  let use = 0
  const uid = () => 'u' + ++use
  const coreRuns = []
  const api = {
    $,
    sounds,
    blits,
    coreRuns,
    get toolSpec() {
      return toolSpec
    },
    tick: ms => (now += ms),
    // one period of every live timer; a timer started during the pass waits for the next one
    everyTick: async () => {
      for (const t of [...every]) if (t.isOn) await t.cb()
    },
    frameTimers: () => every.filter(t => t.isOn && t.ms < 100).length,
    fireTimers: async () => {
      for (const t of timers.splice(0)) await t.cb()
    },
    call: input => dispatch('tool.call', { tool: TOOL, tool_use_id: uid(), ...input }, () => ({ result: 'core reached' })),
    work: (tool = 'Edit', isReadOnly = false) =>
      dispatch('tool.call', { tool, command: 'x', tool_use_id: uid() }, () => {
        coreRuns.push(tool)
        return isReadOnly ? { result: {}, text: '', isReadOnly: true } : { result: {}, text: '' }
      }),
    exitPlan: result => dispatch('tool.call', { tool: 'ExitPlanMode', tool_use_id: uid() }, () => result),
    spawn: (agentId, description, parentAgentId, subagentType = 'general-purpose', model = 'claude-haiku-4-5-20251001') =>
      dispatch('agent.spawn', { description, subagentType, parentAgentId }, () => ({ agentId, model })),
    // one request of an agent's loop; `usage` is what its response reports (the four counts), absent for none
    step: (agentId, effort, usage, model = 'claude-haiku-4-5-20251001') => (async () => {
      const reply = { turnId: 't', index: 0, answer: '', toolUses: [], stopReason: usage ? 'tool_use' : null, usage: usage ? { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage, model } : null }
      const g = hooks.find(h => h.event === 'turn.step').fn($, { agentId, model, effort, turnId: 't', index: 0, messageCount: 1 }, async function* () { return reply })
      let r = await g.next()
      while (!r.done) r = await g.next()
      return r.value
    })(),
    agentTool: (agentId, tool) => dispatch('tool.call', { tool, agentId, tool_use_id: uid() }, () => ({ result: {} })),
    // the engine's notice that a permission dialog has waited on the person (6 s on the desktop) or another kind of notice
    notify: (notification_type, agentId) =>
      dispatch('classic.Notification', { notification_type, message: 'Claude needs your permission to use Bash', ...(agentId ? { agent_id: agentId } : {}) }, () => ({})),
    // an agent's call held on a permission prompt: the check says ask and the call stays open past the mod's 600 ms wait
    approval: agentId => {
      const id = uid()
      return dispatch('tool.call', { tool: 'Bash', agentId, tool_use_id: id }, async () => {
        await dispatch('tool.check', { tool: 'Bash', tool_use_id: id }, () => ({ decision: 'ask' }))
        await api.fireTimers()
        return { result: {} }
      })
    },
    turnComplete: (agentId, reason = 'answer') => dispatch('turn.complete', { agentId, reason }, () => ({})),
    turnStart: () => dispatch('turn.start', {}, () => ({})),
    // a question from the main loop, or from a subagent's loop when agentId is given
    ask: agentId => dispatch('tool.call', { tool: 'AskUserQuestion', agentId, tool_use_id: uid() }, () => ({ result: {} })),
    // an agent's call held for approval: the permission check answers "ask" and the call stays open until release()
    hold: async agentId => {
      const id = uid()
      let release
      const held = new Promise(r => (release = r))
      let checked
      const asked = new Promise(r => (checked = r))
      const call = dispatch('tool.call', { tool: 'Bash', agentId, tool_use_id: id }, async () => {
        await dispatch('tool.check', { tool: 'Bash', tool_use_id: id }, () => ({ decision: 'ask' }))
        checked()
        await held
        return { result: {} }
      })
      await asked
      return { release: async () => (release(), call) }
    },
    command: name => dispatch('command.run', { command: name, args: '' }, () => ({})),
    sessionStart: () => dispatch('session.start', {}, () => ({})),
    stop: (msg = 'Done.') => dispatch('classic.Stop', { stop_hook_active: false, last_assistant_message: msg, background_tasks: [] }, () => ({})),
    plans: () => $.__get({ ref: { key: 'plans' }, initial: [] }),
    bar: id => api.plans().find(p => p.id === id),
    steps: id => (api.bar(id)?.stages ?? []).flatMap(s => s.steps.map(st => `${st.title}:${st.status}`)).join(' '),
    // the footer's mode labels as the real SessionMode render leaves them; 'native' when the engine draws them alone
    modes: () => dispatch('ui.render', { component: 'SessionMode', surface: 'desktop', props: { modes: [] } }, () => 'native'),
    // what the person sees, read from the real AbovePrompt render: the Svg alt text and source of one bar
    svgs: async () => {
      const tree = await dispatch('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: globalThis.COLS ?? 120, hasSurvey: false } }, () => null)
      const found = []
      const walk = n => {
        if (Array.isArray(n)) return n.forEach(walk)
        if (!n || typeof n !== 'object') return
        if (n.type === 'Svg') found.push(n.props)
        ;(n.children ?? []).forEach(walk)
      }
      walk(tree)
      return found
    },
    terminal: async (cols = 120, isFullscreen = false) => {
      const tree = await dispatch('ui.render', { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', viewport: { columns: cols, rows: 40, isFullscreen }, props: { bodyColumns: cols, hasSurvey: false } }, () => null)
      const found = []
      const walk = n => {
        if (Array.isArray(n)) return n.forEach(walk)
        if (!n || typeof n !== 'object') return
        found.push(n)
        ;(n.children ?? []).forEach(walk)
      }
      walk(tree)
      return found
    },
    // the real AbovePrompt tree; a surface without images (the terminal) resolves no Svg
    tree: async ({ hasSvg = true } = {}) => {
      const resolve = $.ui.resolve
      if (!hasSvg) $.ui.resolve = () => ({ Box: 'Box', Button: 'Button', Text: 'Text' })
      try {
        return await dispatch('ui.render', { component: 'AbovePrompt', surface: hasSvg ? 'desktop' : 'terminal', props: { bodyColumns: 140, hasSurvey: false } }, () => null)
      } finally {
        $.ui.resolve = resolve
      }
    },
    // the Buttons of the real AbovePrompt render, and a press on one by its key, as a click would
    buttons: async () => {
      const tree = await dispatch('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 140, hasSurvey: false } }, () => null)
      const found = []
      const walk = n => {
        if (Array.isArray(n)) return n.forEach(walk)
        if (!n || typeof n !== 'object') return
        if (n.type === 'Button') found.push(n.props)
        ;(n.children ?? []).forEach(walk)
      }
      walk(tree)
      return found
    },
    press: async key => {
      const hit = (await api.buttons()).find(b => b.key === key)
      if (!hit) throw new Error(`no button ${key}`)
      await hit.onPress({ surface: 'desktop' })
    },
    view: async id => {
      const tree = await dispatch('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 140, hasSurvey: false } }, () => null)
      const found = []
      // a strip's drawing sits in a keyed row with its open button; it takes the row's key
      const walk = (n, key) => {
        if (Array.isArray(n)) return n.forEach(c => walk(c, key))
        if (!n || typeof n !== 'object') return
        if (n.type === 'Svg') found.push({ ...n.props, key: n.props.key ?? key })
        ;(n.children ?? []).forEach(c => walk(c, n.props?.key ?? key))
      }
      walk(tree)
      const title = api.bar(id)?.title
      const svg = found.find(p => p.alt.startsWith(title + ':'))
      // the bar's agent strips are separate drawings keyed after it
      const strips = found.filter(p => String(p.key ?? '').startsWith(`strip-${id}-`))
      // the see-through hover layer drawn over the track
      const overlay = found.slice(found.indexOf(svg) + 1).find(p => p.isInteractive)
      return svg ? { alt: svg.alt, source: svg.source + strips.map(p => p.source).join('') + (overlay?.source ?? ''), track: svg.source, overlay: overlay?.source ?? '', strips: strips.map(p => p.source), height: svg.height } : null
    },
  }
  await api.sessionStart()
  return api
}

export const S = (name, ...steps) => ({ name, steps: steps.map(s => (typeof s === 'string' ? { title: s, status: 'pending' } : s)) })
export const st = (title, status) => ({ title, status })
