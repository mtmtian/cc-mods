// a stand-in engine around the real, compiled register.tsx: hooks run as written, only $ is faked
globalThis.h = (type, props, ...children) => ({ type, props: props ?? {}, children })

export const TOOL = 'mcp__plan-progress__plan_progress'

export async function boot(file, kept = new Map()) {
  // a fresh module instance per scenario, so its module-level maps start empty; reload() loads another one
  // over the same state and store, as the engine does when the mod is updated or edited
  let hooks = []
  const load = async () => {
    const mod = await import(new URL(file, import.meta.url).href + '?n=' + Math.random())
    hooks = []
    // globalThis.OPTIONS plays the userConfig values the manifest declares
    mod.register((event, a, b) => hooks.push(b ? { event, matcher: a, fn: b } : { event, matcher: null, fn: a }), globalThis.OPTIONS ?? {})
  }
  await load()

  const state = new Map()
  // how many times each key was written: the engine draws a component again only when a key its last draw read moved
  const versions = new Map()
  let asked = null
  // the session the process starts under (globalThis.SESSION, default session-1); a /clear or a /resume goes on under
  // another (sessionEnd, switchSession)
  let sessionId = globalThis.SESSION ?? 'session-1'
  let now = 1_000_000
  const timers = []
  const every = []
  const sounds = []
  let toolSpec = null
  const blits = []
  const notices = []
  // the panes the mod opened, by id, with what it asked for; and every option it set as /config would
  const panes = new Map()
  const configSets = []
  const sleeps = []
  // the commands the mod registered: running one it did not register fails, as the engine knows no such command
  const commands = new Set()
  // $.agent.list()'s rows by agent id (AgentInfo): a spawn adds one running, its loop's work keeps it running, its
  // turn.complete words how it ended; a test edits or drops rows to play what the engine reports
  const agentRows = new Map()
  const working = agentId => {
    const row = agentId && agentRows.get(agentId)
    if (row) row.status = 'running'
  }
  // the machine the stub plays: globalThis.MAC (default true), DARK for the macOS appearance,
  // TERM_PROGRAM for the terminal, THEME for Claude Code's theme setting, SCHEME for a Linux desktop's
  // color-scheme (gsettings is missing while it is unset)
  const procs = []
  const rings = []
  const procEnvs = []
  // what the mod fetched ($.http.fetch) and which commands it ran ($.command.run)
  const fetches = []
  const commandRuns = []
  // $.state holds JSON data on the host's side: every read hands back a fresh copy, as the engine does, so the module
  // can never rely on getting the same object twice
  const $ = {
    __get(a) {
      // the keys a draw reads are the ones whose writes make the engine draw it again (reask)
      this.__reads?.add(a.ref.key)
      return state.has(a.ref.key) ? JSON.parse(state.get(a.ref.key)) : a.initial
    },
    __update(a, fn) {
      const v = fn(this.__get(a))
      versions.set(a.ref.key, (versions.get(a.ref.key) ?? 0) + 1)
      state.set(a.ref.key, JSON.stringify(v))
      return JSON.parse(state.get(a.ref.key))
    },
    clock: { now: async () => now, sleep: async ms => void sleeps.push(ms), after: (ms, cb) => {
        const t = { at: now + ms, cb, isOn: true }
        timers.push(t)
        return { cancel: () => void (t.isOn = false) }
      }, every: (ms, cb) => {
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
    session: { id: async () => sessionId },
    audio: { play: async ({ asset }) => void sounds.push(asset) },
    process: {
      run: async (argv, init) => {
        if (globalThis.ABORTED) throw new Error(`$.process.run(${argv[0]}) aborted`)
        procs.push(argv.join(' '))
        procEnvs.push(init?.env ?? {})
        // globalThis.CLI plays the claude CLI, on PATH or by its path (argv in, { exitCode, stdout, stderr } out); unset,
        // it is not found
        if (/(^|[\\/])claude(\.exe)?$/i.test(argv[0])) {
          if (!globalThis.CLI) throw new Error('claude: not found')
          return globalThis.CLI(argv)
        }
        // OMARCHY plays the active Omarchy theme's colors.toml; unset, the file is missing
        if (argv[0] === '/bin/sh' && String(argv[2]).includes('colors.toml')) {
          return globalThis.OMARCHY === undefined ? { exitCode: 1, stdout: '', stderr: 'No such file or directory' } : { exitCode: 0, stdout: globalThis.OMARCHY, stderr: '' }
        }
        if (argv[0] === 'gsettings') {
          if (globalThis.SCHEME === undefined) throw new Error('gsettings: not found')
          return { exitCode: 0, stdout: `'${globalThis.SCHEME}'\n`, stderr: '' }
        }
        if (globalThis.MAC === false) throw new Error(`${argv[0]}: not found`)
        if (argv[0] === 'defaults') return { exitCode: globalThis.DARK ? 0 : 1, stdout: globalThis.DARK ? 'Dark\n' : '', stderr: '' }
        if (argv[0] === '/bin/sh') return { exitCode: 0, stdout: globalThis.TERM_PROGRAM ?? '', stderr: '' }
        // REG_LOCALE plays Windows' language setting, as reg query prints it
        if (argv[0] === 'reg') return globalThis.REG_LOCALE ? { exitCode: 0, stdout: `\r\nHKEY_CURRENT_USER\\Control Panel\\International\r\n    LocaleName    REG_SZ    ${globalThis.REG_LOCALE}\r\n\r\n`, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'ERROR: not found' }
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
    // globalThis.ROOT plays where the plugin is installed (a drive letter on Windows); read at each use, as an update
    // reloads the mod from its new folder
    plugin: {
      get root() {
        return this.setRoot ?? globalThis.ROOT ?? '/plugin'
      },
      set root(path) {
        this.setRoot = path
      },
    },
    // globalThis.ENV plays the variables $.env.get reads, globalThis.FILES the files $.fs.read finds (by path)
    env: { get: async name => globalThis.ENV?.[name] },
    fs: {
      read: async path => {
        const text = globalThis.FILES?.[path]
        if (text === undefined) throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' })
        return text
      },
    },
    // globalThis.NO_TOOL plays an engine whose loopback link to the mod's tools failed: the tool is registered
    // but never reaches the session's list
    tool: {
      register: async spec => void (toolSpec = spec),
      list: async () => [{ name: 'Read' }, ...(toolSpec && !globalThis.NO_TOOL ? [{ name: TOOL }] : [])],
    },
    // globalThis.COMMAND_RUN plays what running a command answers (a function of the request); unset, {}
    command: {
      register: async ({ name }) => void commands.add(name),
      run: async req => {
        commandRuns.push(req)
        return globalThis.COMMAND_RUN ? globalThis.COMMAND_RUN(req) : {}
      },
    },
    // globalThis.HTTP plays the network (url, init in, { status, ok, headers, text } out); unset, every fetch fails
    http: {
      fetch: async (url, init) => {
        fetches.push(url)
        if (!globalThis.HTTP) throw new Error('fetch failed: no network in the tests')
        return globalThis.HTTP(url, init)
      },
    },
    agent: { list: async () => [...agentRows.values()].map(row => ({ ...row })) },
    // globalThis.CONFIG_DENY plays a set the engine refuses (a locked row, another plugin's hook); a set that goes
    // through is only recorded: the engine would reload the mod with the new options, which a test plays with reload()
    // the language row says English unless globalThis.LANGUAGE says otherwise: the settings window would else speak the
    // language of the machine the tests run on
    config: {
      list: async () => [...(globalThis.THEME === undefined ? [] : [{ key: 'theme', value: globalThis.THEME }]), { key: 'language', value: globalThis.LANGUAGE ?? 'English' }],
      set: async ({ key, value }) => {
        configSets.push({ key, value })
        // CONFIG_MISSING plays the engine's plugin list being reloaded: the next n sets find no row for the key
        if (globalThis.CONFIG_MISSING > 0) {
          globalThis.CONFIG_MISSING--
          return { deny: `plan-progress: $.config.set: no /config row with key ${key} ($.config.list names them)` }
        }
        return globalThis.CONFIG_DENY ? { deny: String(globalThis.CONFIG_DENY) } : { value }
      },
    },
    ui: {
      // the engine's terminal table carries an Svg as well, whatever its types say, and draws it as nothing (seen in a
      // real terminal: the settings window took the desktop's layout, its switches blank)
      resolve: e => (e?.surface === 'terminal' ? { Box: 'Box', Button: 'Button', Text: 'Text', Link: 'Link', Raster: 'Raster', Svg: 'Svg' } : { Box: 'Box', Button: 'Button', Text: 'Text', Link: 'Link', Svg: 'Svg' }),
      toast: (text, options) => void notices.push({ via: 'toast', text, options }),
      log: text => void notices.push({ via: 'log', text }),
      // globalThis.BLIT_DENY plays an engine that refuses the blits (the band unmounted or redrawn at another size)
      blit: async args => {
        blits.push(args)
        return globalThis.BLIT_DENY ? { deny: String(globalThis.BLIT_DENY) } : {}
      },
      // globalThis.PANE_WAIT plays a session whose surfaces place no pane now: it opens, undrawn, saying why
      open: async args => {
        panes.set(args.id, args)
        return globalThis.PANE_WAIT ? { isPlaced: false, reason: String(globalThis.PANE_WAIT) } : { isPlaced: true }
      },
      close: async ({ id }) => void panes.delete(id),
      // where the mod moves a site's focus ring: { requestId, key } each
      focus: async args => void rings.push(args),
      panes: async () => [...panes.values()].map(p => ({ id: p.id, title: p.title ?? p.id })),
    },
  }
  const matches = (m, e) => !m || Object.entries(m).every(([k, v]) => e[k] === v)
  // what the host and the plugins after this one draw above the prompt: nothing, unless globalThis.BELOW gives a tree
  // (or a function making one, called once per render)
  const below = () => (typeof globalThis.BELOW === 'function' ? globalThis.BELOW() : (globalThis.BELOW ?? null))
  const dispatch = (event, e, core) => {
    const chain = hooks.filter(h => h.event === event && matches(h.matcher, e))
    // ABORTED plays a dispatch the engine abandons: next.signal reads aborted, and the $ calls made meanwhile reject
    const signal = globalThis.ABORTED ? AbortSignal.abort() : new AbortController().signal
    const run = (i, ev) => (i < chain.length ? chain[i].fn($, ev, Object.assign(ev2 => run(i + 1, ev2), { signal })) : Promise.resolve(core(ev)))
    return run(0, e)
  }

  let use = 0
  const uid = () => 'u' + ++use
  const coreRuns = []
  const api = {
    $,
    sounds,
    agentRows,
    blits,
    notices,
    procs,
    rings,
    procEnvs,
    fetches,
    commandRuns,
    // the hooks module loads again: its timers stop, its module variables start over, $.state and the store stay
    reload: async () => {
      for (const t of every) t.isOn = false
      timers.splice(0)
      commands.clear()
      await load()
      await api.sessionStart()
    },
    setTheme: value => dispatch('config.set', { key: 'theme', value, previous: globalThis.THEME ?? 'dark' }, () => ({ value })),
    coreRuns,
    // any event straight into the hooks, the core answering nothing
    raw: (event, e) => dispatch(event, e, () => (event === 'ui.render' ? below() : {})),
    // a message the person sends: the context lines the hooks pass on with it
    submit: (kind = 'composer') => dispatch('prompt.submit', { origin: { kind }, context: [] }, ev => ev.context ?? []),
    get toolSpec() {
      return toolSpec
    },
    tick: ms => (now += ms),
    // one period of every live timer; a timer started during the pass waits for the next one
    everyTick: async () => {
      for (const t of [...every]) if (t.isOn) await t.cb()
    },
    frameTimers: () => every.filter(t => t.isOn && t.ms < 100).length,
    // one period of the frame clock alone (timers under 100 ms), as the 33 ms clock fires many times a second;
    // a frame runs on by itself after its timer returns, so the period ends once it has
    frameTick: async () => {
      for (const t of [...every]) if (t.isOn && t.ms < 100) await t.cb()
      await new Promise(r => setTimeout(r, 0))
    },
    fireTimers: async () => {
      // only the timers due by now (tick moves now), in the order they fall due; the rest wait
      const due = timers.filter(t => t.at <= now).sort((x, y) => x.at - y.at)
      for (const t of due) timers.splice(timers.indexOf(t), 1)
      for (const t of due) if (t.isOn) await t.cb()
    },
    call: input => dispatch('tool.call', { tool: TOOL, tool_use_id: uid(), ...input }, () => ({ result: 'core reached' })),
    work: (tool = 'Edit', isReadOnly = false) =>
      dispatch('tool.call', { tool, command: 'x', tool_use_id: uid() }, () => {
        coreRuns.push(tool)
        return isReadOnly ? { result: {}, text: '', isReadOnly: true } : { result: {}, text: '' }
      }),
    exitPlan: result => dispatch('tool.call', { tool: 'ExitPlanMode', tool_use_id: uid() }, () => result),
    spawn: (agentId, description, parentAgentId) =>
      dispatch('agent.spawn', { description, subagentType: 'general-purpose', parentAgentId }, () => {
        agentRows.set(agentId, { id: agentId, description, type: 'general-purpose', status: 'running', ...(parentAgentId ? { parentId: parentAgentId } : {}) })
        return { agentId, model: 'claude-haiku-4-5-20251001' }
      }),
    step: (agentId, effort) => (async () => { working(agentId); const g = hooks.find(h => h.event === 'turn.step').fn($, { agentId, model: 'claude-haiku-4-5-20251001', effort, turnId: 't', index: 0, messageCount: 1 }, async function* () {}); for await (const _ of g); })(),
    // a model response streamed through the turn.step hook: pieces are [chunk, ms to wait before it]; the stop chunk
    // carries output_tokens, and the step's result lists the tools the API ran itself when serverToolUses is given.
    // Resolves to the chunks the hook passed on
    stream: async (pieces, { agentId, outputTokens, model = 'claude-opus-5-5', serverToolUses } = {}) => {
      let done
      const result = new Promise(r => (done = r))
      const beneath = (async function* () {
        for (const [chunk, wait] of pieces) {
          if (wait) await new Promise(r => setTimeout(r, wait))
          yield chunk
        }
        const usage = { input_tokens: 10, output_tokens: outputTokens ?? 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model }
        yield { kind: 'stop', stopReason: 'end_turn', usage }
        done({ turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage, ...(serverToolUses ? { serverToolUses } : {}) })
      })()
      beneath.result = result
      const out = []
      const g = hooks.find(h => h.event === 'turn.step').fn($, { agentId, model, turnId: 't', index: 0, messageCount: 1 }, () => beneath)
      for await (const c of g) out.push(c)
      return out
    },
    agentTool: (agentId, tool) => (working(agentId), dispatch('tool.call', { tool, agentId, tool_use_id: uid() }, () => ({ result: {} }))),
    turnComplete: (agentId, reason = 'answer') => {
      const row = agentId && agentRows.get(agentId)
      if (row) row.status = reason === 'answer' ? 'completed' : reason === 'aborted' ? 'killed' : 'failed'
      return dispatch('turn.complete', { agentId, reason }, () => ({}))
    },
    turnStart: () => dispatch('turn.start', {}, () => ({})),
    // a question from the main loop, or from a subagent's loop when agentId is given; answer plays the person
    // answering, run while the dialog is still open
    ask: (agentId, answer = () => ({ result: {} })) => dispatch('tool.call', { tool: 'AskUserQuestion', agentId, tool_use_id: uid() }, answer),
    // an agent's call the permission check answers "ask"; the call stays open until release().
    // dialog: true shows the person the permission dialog (classic PermissionRequest), as the default mode does;
    // false is the auto-mode classifier settling the ask by itself, so no dialog appears and the tool just runs
    hold: async (agentId, { dialog = true } = {}) => {
      working(agentId)
      const id = uid()
      let release
      const held = new Promise(r => (release = r))
      let checked
      const asked = new Promise(r => (checked = r))
      const call = dispatch('tool.call', { tool: 'Bash', agentId, tool_use_id: id }, async () => {
        await dispatch('tool.check', { tool: 'Bash', tool_use_id: id }, () => ({ decision: 'ask' }))
        if (dialog) await dispatch('classic.PermissionRequest', { hook_event_name: 'PermissionRequest', agent_id: agentId, tool_name: 'Bash', tool_input: {} }, () => ({}))
        checked()
        await held
        return { result: {} }
      })
      await asked
      return { release: async () => (release(), call) }
    },
    // the person refuses the dialog of an agent's held call
    deny: agentId => dispatch('classic.PermissionDenied', { hook_event_name: 'PermissionDenied', agent_id: agentId, tool_name: 'Bash', tool_input: {}, tool_use_id: uid(), reason: 'no' }, () => ({})),
    commands,
    command: name => (commands.has(name) ? dispatch('command.run', { command: name, args: '' }, () => ({})) : Promise.reject(new Error(`unknown command /${name}`))),
    sessionStart: () => dispatch('session.start', {}, () => ({})),
    // the session ends while the process goes on (reason clear or resume): the hooks hear session.end, then the host
    // wipes every value in $.state; no session.start follows, and switchSession moves the process to its next id
    sessionEnd: async (reason = 'resume') => {
      await dispatch('session.end', { reason, sessionId, resume: { id: sessionId } }, () => ({ sessionId }))
      state.clear()
    },
    switchSession: id => void (sessionId = id),
    stop: (msg = 'Done.') => dispatch('classic.Stop', { stop_hook_active: false, last_assistant_message: msg, background_tasks: [] }, () => ({})),
    plans: () => $.__get({ ref: { key: 'plans' }, initial: [] }),
    bar: id => api.plans().find(p => p.id === id),
    steps: id => (api.bar(id)?.stages ?? []).flatMap(s => s.steps.map(st => `${st.title}:${st.status}`)).join(' '),
    // what the person sees, read from the real AbovePrompt render: the Svg alt text and source of one bar
    // the desktop asking the band again (another instance invalidated, the footer's figure changed), answered as the
    // engine does: drawn anew when a key the last draw read was written since, else that last answer handed back as it
    // was, with the offsets written into it then, and no ui.render call at all
    reask: async () => {
      if (asked && asked.reads.every(([k, n]) => (versions.get(k) ?? 0) === n)) return asked.svgs
      $.__reads = new Set()
      try {
        const svgs = await api.svgs()
        asked = { svgs, reads: [...$.__reads].map(k => [k, versions.get(k) ?? 0]) }
        return svgs
      } finally {
        $.__reads = null
      }
    },
    svgs: async () => {
      const tree = await dispatch('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: globalThis.COLS ?? 120, hasSurvey: false } }, below)
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
      const tree = await dispatch('ui.render', { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', viewport: { columns: cols, rows: 40, isFullscreen }, props: { bodyColumns: cols, hasSurvey: false } }, below)
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
    footer: async (surface, isFullscreen) => {
      const tree = await dispatch('ui.render', { component: 'SessionMode', surface, viewport: { columns: 120, rows: 40, isFullscreen }, props: { modes: [] } }, () => null)
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
    panes,
    configSets,
    sleeps,
    // one pane drawn as the surface asks it: the desktop docks it beside the transcript, the terminal seats it above
    // the prompt. Every element of the tree, flat
    pane: async (id, surface = 'desktop') => {
      const dock = surface === 'desktop'
      const tree = await dispatch('ui.render', { component: 'Pane', requestId: id, surface, viewport: { columns: 120, rows: 40, isFullscreen: dock }, props: { title: panes.get(id)?.title ?? id, isFocused: true, bodyColumns: globalThis.PANE_COLS ?? (dock ? 63 : 118), placement: dock ? 'dock' : 'inline' } }, () => null)
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
    // the person presses the Button keyed `key` in a drawn tree (footer(), pane(), terminal()): its onPress runs to the
    // end, as the engine settles a press. False when the tree has no such Button
    press: async (nodes, key, surface = 'desktop') => {
      const button = nodes.find(n => n.type === 'Button' && n.props?.key === key)
      if (!button) return false
      await button.props.onPress?.({ surface, element: key })
      return true
    },
    // the desktop band's tree as the hooks answer it
    band: () => dispatch('ui.render', { component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 140, hasSurvey: false } }, below),
    view: async id => {
      const tree = await api.band()
      const found = []
      // a strip's drawing sits in a keyed row with its open button; it takes the row's key. A drawing under a Box drawn
      // display none that a hover shows is marked as such
      const walk = (n, key, isRevealed) => {
        if (Array.isArray(n)) return n.forEach(c => walk(c, key, isRevealed))
        if (!n || typeof n !== 'object') return
        if (n.type === 'Svg') found.push({ ...n.props, key: n.props.key ?? key, isRevealed })
        const reveals = n.type === 'Box' && n.props?.display === 'none' && n.props?.hover?.display === 'flex'
        ;(n.children ?? []).forEach(c => walk(c, n.props?.key ?? key, isRevealed || reveals))
      }
      walk(tree)
      const title = api.bar(id)?.title
      const svg = found.find(p => p.alt.startsWith(title + ':'))
      // the bar's agent strips are separate drawings keyed after it
      const strips = found.filter(p => String(p.key ?? '').startsWith(`strip-${id}-`))
      // the see-through hover layer drawn over the track, and the pill's clock the desktop shows on hover under it
      const after = found.slice(found.indexOf(svg) + 1)
      const overlay = after.find(p => p.isInteractive)
      const clock = after.slice(0, overlay ? after.indexOf(overlay) : after.length).find(p => p.isRevealed)
      return svg
        ? {
            alt: svg.alt,
            source: svg.source + strips.map(p => p.source).join('') + (overlay?.source ?? '') + (clock?.source ?? ''),
            track: svg.source,
            overlay: overlay?.source ?? '',
            clock: clock?.source ?? '',
            strips: strips.map(p => p.source),
            height: svg.height,
          }
        : null
    },
  }
  await api.sessionStart()
  return api
}

export const S = (name, ...steps) => ({ name, steps: steps.map(s => (typeof s === 'string' ? { title: s, status: 'pending' } : s)) })
export const st = (title, status) => ({ title, status })
