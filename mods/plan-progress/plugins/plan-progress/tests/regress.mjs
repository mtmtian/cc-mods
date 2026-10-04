// the audit's cases after the fixes: each check states the behaviour the mod should have now
import { boot, S, st } from './engine.mjs'

const file = process.argv[2] ?? './register.mjs'
const three = () => [S('One', st('A', 'active'), 'B'), S('Two', 'C')]
const create = (E, id = 't', stages = three(), title = 'Task') => E.call({ id, title, stages })
const res = r => r.deny ?? r.result
const glyphs = cells => {
  const w = new Uint32Array(Uint8Array.from(Buffer.from(cells, 'base64')).buffer)
  let out = ''
  for (let i = 0; i < w.length; i += 3) out += String.fromCodePoint(w[i])
  return out
}
const pct = async (E, id) => (await E.view(id)).alt.match(/\d+%/)?.[0]
// WCAG contrast of two #RRGGBB colours
const luminance = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
// the time a running clock reads in a drawing, and the tick that draws the band again
const clock = s => s?.match(/ ck">([^<]*)</)?.[1]
const tickOf = E => E.$.__get({ ref: { key: 'tick' }, initial: 0 })
// the nodes of a tree that match, depth first
const nodes = (n, pred, acc = []) => {
  if (Array.isArray(n)) n.forEach(c => nodes(c, pred, acc))
  else if (n && typeof n === 'object') {
    if (pred(n)) acc.push(n)
    ;(n.children ?? []).forEach(c => nodes(c, pred, acc))
  }
  return acc
}

const C = {
  async T01_next(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', next: true })
    return [E.steps('t'), E.steps('t') === 'A:done B:done C:active']
  },
  async T02_T04_snapshot(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', stages: [S('New', st('C', 'active'), st('A', 'done'), st('B2', 'pending'))] })
    return [`${E.plans().length} bar; ${E.steps('t')}`, E.plans().length === 1 && E.steps('t') === 'C:active A:done B2:pending']
  },
  async T03_percent_after_append(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', next: true })
    const a = await pct(E, 't')
    await E.call({ id: 't', stages: [S('One', st('A', 'done'), st('B', 'done')), S('Two', st('C', 'active'), 'D')] })
    return [`${a} → ${await pct(E, 't')}`, a === '67%' && (await pct(E, 't')) === '50%']
  },
  async T05_resend_keeps_done(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', stages: [S('One', 'A', 'B'), S('Two', 'C', 'D')] })
    return [E.steps('t'), E.steps('t') === 'A:done B:done C:active D:pending']
  },
  async T05b_active_redoes(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', stages: [S('One', st('A', 'active'), 'B'), S('Two', 'C')] })
    return [E.steps('t'), E.steps('t') === 'A:active B:pending C:pending']
  },
  async T06_T07_create_without_status(E) {
    const r = await E.call({ id: 't', title: 'Task', stages: [{ name: 'One', steps: [{ title: 'A' }, { title: 'B' }] }] })
    const req = E.toolSpec.inputSchema.properties.stages.items.properties.steps.items.required
    return [`${E.steps('t')}; ${res(r)}; required ${req}`, E.steps('t') === 'A:active B:pending' && req.join() === 'title']
  },
  // cc-mods: no footer button; the footer is the engine's whether or not a bar is up
  async footer_left_to_the_engine(E) {
    const before = await E.modes()
    await create(E)
    const during = await E.modes()
    return [`no plan: ${JSON.stringify(before)}; plan: ${JSON.stringify(during)}`, before === 'native' && during === 'native']
  },
  async T11_active_forward_unchanged(E) {
    await create(E)
    await E.call({ id: 't', active: 'C' })
    return [E.steps('t'), E.steps('t') === 'A:done B:pending C:active']
  },
  async T12_out_of_order(E) {
    const r = await E.call({ id: 't', title: 'Task', stages: [S('First', st('A', 'pending')), S('Second', st('B', 'active'), st('C', 'done'))] })
    const v = await E.view('t')
    return [`"${res(r)}"; "${v.alt}"`, res(r).includes('1/3') && v.alt.includes('Second') && v.alt.includes('33%')]
  },
  async T13_duplicate_titles(E) {
    await E.call({ id: 't', title: 'Task', stages: [S('Backend', st('API', 'active'), 'Tests'), S('Frontend', 'UI', 'Tests')] })
    await E.call({ id: 't', done: ['Tests'] })
    await E.call({ id: 't', done: ['Tests'] })
    return [E.steps('t'), E.steps('t') === 'API:active Tests:done UI:pending Tests:done']
  },
  async T14_unknown_refused(E) {
    await create(E)
    const r = await E.call({ id: 't', done: ['Nonexistent'] })
    return [`${r.deny}`, !!r.deny && r.deny.includes('A, B, C') && E.steps('t') === 'A:active B:pending C:pending']
  },
  async T15_ops_with_stages(E) {
    await create(E)
    await E.call({ id: 't', stages: [S('One', st('A', 'active'), 'B'), S('Two', 'C')], next: true })
    return [E.steps('t'), E.steps('t') === 'A:done B:active C:pending']
  },
  async T16_T17_strips_survive(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', stages: [S('One', 'A', 'B', 'X'), S('Two', 'C')] })
    await E.agentTool('ag1', 'Grep')
    const src = (await E.view('t')).source
    return [`strip ${src.includes('Scan tests')}, tool ${src.includes('Grep')}`, src.includes('Scan tests') && src.includes('Grep')]
  },
  async T19_parallel_next(E) {
    await create(E)
    await Promise.all([E.call({ id: 't', next: true }), E.call({ id: 't', next: true })])
    return [E.steps('t'), E.steps('t') === 'A:done B:done C:active']
  },
  async T20_parallel_bars(E) {
    await Promise.all([create(E, 'x'), create(E, 'y')])
    return [E.plans().map(p => p.id).join(), E.plans().length === 2]
  },
  async T21_unknown_failed_refused(E) {
    await create(E)
    const r = await E.call({ id: 't', failed: 'Nope' })
    return [`${E.bar('t').state}; deny ${!!r.deny}`, !!r.deny && E.bar('t').state === 'running']
  },
  async T22_done_result_has_no_active(E) {
    await create(E)
    const r = await E.call({ id: 't', state: 'done' })
    return [res(r), res(r) === 't: 3/3, done']
  },
  async T23_reminder_names_bar(E) {
    await E.turnStart()
    await create(E)
    const out = []
    for (let i = 0; i < 6; i++) out.push(await E.work('Edit'))
    const hit = out.findIndex(r => (r.context ?? []).some(c => c.includes('not updated')))
    return [`#${hit + 1}: ${out[hit]?.context}`, hit === 5 && out[hit].context.some(c => c.includes('t '))]
  },
  async T24_refusal_keeps_count(E) {
    await E.turnStart()
    await create(E)
    let hit = -1
    for (let i = 0; i < 6; i++) {
      if (i === 3) await E.call({ id: 't', done: ['Nonexistent'] })
      const r = await E.work('Edit')
      if (hit < 0 && (r.context ?? []).some(c => c.includes('not updated'))) hit = i
    }
    return [`reminder on edit #${hit + 1}`, hit === 5]
  },
  async T25_shell_never_refused(E) {
    await E.turnStart()
    for (let i = 0; i < 3; i++) await E.work('Edit')
    const bash = await E.work('Bash', false)
    const edit = await E.work('Edit')
    return [`bash ${bash.deny ? 'denied' : 'ran'}, 4th edit ${edit.deny ? 'denied' : 'ran'}`, !bash.deny && !!edit.deny]
  },
  async T25b_shell_not_counted(E) {
    await E.turnStart()
    await create(E)
    let reminded = false
    for (let i = 0; i < 12; i++) if (((await E.work('Bash', false)).context ?? []).length) reminded = true
    return [`12 shell calls, reminder ${reminded}`, !reminded]
  },
  async T27_no_substeps_in_schema(E) {
    const step = E.toolSpec.inputSchema.properties.stages.items.properties.steps.items.properties
    return [Object.keys(step).join(), !('substeps' in step)]
  },
  async T32_next_wraps_back(E) {
    await E.call({ id: 't', title: 'Task', stages: [S('One', 'A', st('B', 'active'), 'C')] })
    await E.call({ id: 't', next: true })
    await E.call({ id: 't', next: true })
    const a = E.steps('t')
    await E.call({ id: 't', next: true })
    return [`${a} → ${E.steps('t')} ${E.bar('t').state}`, a === 'A:active B:done C:done' && E.bar('t').state === 'done']
  },
  async N2_one_bar_one_block(E) {
    await E.turnStart()
    await create(E, 'login', [S('A', 'One'), S('B', 'Two')], 'Fix login')
    await E.work('Edit')
    await E.call({ id: 'login', next: true })
    await E.call({ id: 'login', next: true })
    const r = await E.stop('All set.')
    return [`${E.plans().length} bar, ${E.bar('login').state}, stop ${r.block ? 'blocked' : 'passes'}`, E.plans().length === 1 && !r.block]
  },
  // cc-mods: the rules ride in the tool description, so engines without prompt.compose still carry them
  async cc_rules_in_tool_description(E) {
    const d = E.toolSpec.description ?? ''
    return [d.slice(0, 60), d.includes('Tasks needing more than ~3 edits') && d.includes('needs_input')]
  },
  // cc-mods: plan mode is not wired any more; an approved plan passes through untouched and makes no bar
  async cc_exit_plan_mode_untouched(E) {
    const r = await E.exitPlan({ result: { plan: '# Fix login\n## A\n- One\n## B\n- Two' } })
    return [`${E.plans().length} bars, context ${JSON.stringify(r.context ?? null)}`, E.plans().length === 0 && r.context === undefined]
  },
  // cc-mods: strip text takes its colour from the theme; a fill written on the text itself would beat the light rule
  async cc_strip_text_follows_theme(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    await E.agentTool('ag1', 'Grep')
    const strips = (await E.svgs()).filter(v => String(v.key ?? '').startsWith('strip-t-')).map(v => v.source).join('')
    const light = strips.match(/@media \(prefers-color-scheme:light\)\{(.*?)\}\}/)?.[1] ?? ''
    const inline = /<text[^>]*style="fill:/.test(strips)
    const ok = strips.includes('Scan tests') && light.includes('.sn{fill:#141413}') && /\.sn\.w\d\{fill:/.test(light) && !inline
    return [`light rule ${light.slice(0, 40)}…, inline text fill ${inline}`, ok]
  },
  // cc-mods: colours come from the desktop app's tokens: white on every state's pill reads at 4.5:1, running is the
  // brand clay, and no cool grey (#808080) is left in what the band draws
  async cc_palette_follows_desktop(E) {
    const onWhite = h => contrast(h, '#FFFFFF')
    const pills = {}
    for (const [id, state] of [['r', 'running'], ['n', 'needs_input'], ['e', 'error'], ['d', 'done']]) {
      await create(E, id, three(), `Bar ${id}`)
      if (state !== 'running') await E.call({ id, state })
      const track = (await E.view(id)).track
      pills[state] = track.match(/<rect x="-[\d.]+" y="0" width="[\d.]+" height="22" rx="11" fill="(#[0-9A-F]{6})"/)?.[1]
      await E.call({ id, state: 'done' })
    }
    await E.spawn('ag1', 'Scan')
    const all = (await E.svgs()).map(v => v.source).join('')
    const worst = Math.min(...Object.values(pills).map(h => (h ? onWhite(h) : 0)))
    const ok = pills.running === '#B55C3E' && worst >= 4.5 && !all.includes('#808080')
    return [`pills ${JSON.stringify(pills)}, worst white ${worst.toFixed(2)}:1, cool grey ${all.includes('#808080')}`, ok]
  },
  // cc-mods: the state glyph before each title follows the theme too, and stands out from either background (3:1)
  async cc_glyph_follows_theme(E) {
    const seen = {}
    for (const [id, state] of [['r', 'running'], ['n', 'needs_input'], ['e', 'error'], ['d', 'done']]) {
      await create(E, id, three(), `Bar ${id}`)
      if (state !== 'running') await E.call({ id, state })
      const glyph = (await E.svgs()).find(v => v.key === `glyph-${id}`)
      // the colour of the mark the glyph actually draws: the dot's fill for running, the icon's stroke otherwise
      const src = glyph?.source ?? ''
      const cls = src.includes('class="gf"') ? 'gf' : 'gs'
      const prop = cls === 'gf' ? 'fill' : 'stroke'
      const [base, media] = src.split('@media (prefers-color-scheme:light)')
      const pick = css => css?.match(new RegExp(`\\.${cls}\\{${prop}:(#[0-9A-F]{6})\\}`))?.[1]
      const dark = pick(base)
      const light = pick(media)
      seen[state] = { dark, light, onDark: dark && contrast(dark, '#262624'), onLight: light && contrast(light, '#FAF9F5'), alt: glyph?.alt }
    }
    const ok = Object.values(seen).every(g => g.dark && g.light && g.onDark >= 3 && g.onLight >= 3 && g.alt)
    const worst = Math.min(...Object.values(seen).flatMap(g => [g.onDark ?? 0, g.onLight ?? 0]))
    return [`${Object.entries(seen).map(([k, g]) => `${k} ${g.dark}/${g.light}`).join(', ')}; worst ${worst.toFixed(1)}:1`, ok]
  },
  // cc-mods: a surface without images (the terminal) keeps the coloured state character, one symbol per state
  async cc_terminal_keeps_text_glyph(E) {
    await create(E)
    await create(E, 'x', [S('X', st('Y', 'active'))], 'Broken')
    await E.call({ id: 'x', failed: 'Y' })
    const texts = []
    const walk = n => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!n || typeof n !== 'object') return
      if (n.type === 'Text' && n.props.color) texts.push(`${n.children.join('')}:${n.props.color}`)
      if (n.type === 'Svg') texts.push('SVG')
      ;(n.children ?? []).forEach(walk)
    }
    walk(await E.tree({ hasSvg: false }))
    return [texts.join(' '), texts.includes('●:#D97757') && texts.includes('×:#B53333') && !texts.includes('SVG')]
  },
  // cc-mods: the demo-reel entry is gone; "reel" with a note is an ordinary id, refused until it has stages
  async cc_reel_entry_gone(E) {
    const r = await E.call({ id: 'reel', note: '/tmp/plan-progress-reel.json' })
    return [res(r), (r.deny ?? '').includes('no bar "reel" yet') && E.plans().length === 0]
  },
  async done_on_active_moves_on(E) {
    await create(E)
    const r = await E.call({ id: 't', done: ['A'] })
    return [res(r), E.steps('t') === 'A:done B:active C:pending']
  },
  async same_bar_same_source_while_time_passes(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    // the still parts: the track picture and the strips, apart from the time their clocks read, which every
    // draw sets from now (the hover layer is rebuilt every redraw by design)
    const still = v => (v.track + v.strips.join('')).replace(/ ck">[^<]*</g, ' ck"><')
    const a = still(await E.view('t'))
    E.tick(7000)
    const b = still(await E.view('t'))
    await E.agentTool('ag1', 'Grep')
    const c = still(await E.view('t'))
    return [`idle redraw same ${a === b}, change redraws ${a !== c}`, a === b && a !== c]
  },
  // cc-mods: the desktop shows a strip's drawing afresh on later redraws, which restarts its one-shot morph. A strip
  // whose word last changed at 1m 00s, drawn 30 s later with nothing changed, read "1m 00s" again with "Needs approval"
  // blurring into "Bash" each time; every draw must write its clock at the time now and morph once
  async cc_idle_strip_redraw_keeps_time_and_morphs_once(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    E.tick(59_000)
    const held = await E.hold('ag1')
    await E.fireTimers() // past the 600 ms wait: the strip reads "Needs approval"
    await E.view('t')
    E.tick(1000)
    await E.agentTool('ag1', 'Bash') // the next call: the word goes back to the tool
    await held.release()
    const at = (await E.view('t')).strips[0] ?? ''
    E.tick(30_000)
    const later = (await E.view('t')).strips[0] ?? ''
    const isMorph = s => s.includes(' mo ') || s.includes('<animate ')
    return [
      `at the change: ${clock(at)}, morph ${isMorph(at)}; 30 s later: ${clock(later)}, morph ${isMorph(later)}`,
      clock(at) === '1m 0s' && isMorph(at) && clock(later) === '1m 30s' && !isMorph(later),
    ]
  },
  // cc-mods: the same for the track's head, which slides to a new step once and then stands; a finished bar's pill
  // (its time) slid in again from mid-track each time the desktop showed the picture afresh
  async cc_track_glides_once(E) {
    await create(E)
    await E.view('t')
    await E.call({ id: 't', next: true })
    const at = (await E.view('t')).track
    E.tick(1000)
    const later = (await E.view('t')).track
    await E.call({ id: 't', state: 'done' })
    const done = (await E.view('t')).track
    E.tick(1000)
    const doneLater = (await E.view('t')).track
    const isGlide = s => s.includes('<animate attributeName="width"')
    return [
      `glide at the step ${isGlide(at)}, a second later ${isGlide(later)}; at done ${isGlide(done)}, a second later ${isGlide(doneLater)}`,
      isGlide(at) && !isGlide(later) && isGlide(done) && !isGlide(doneLater),
    ]
  },
  // cc-mods: only a draw after the slide takes it out of the picture, and a finished bar has no running clock to bring
  // one. A bar at 4 of 6 that finished kept its slide as the band's last answer, and each repaint that never reached
  // the mod (cache-timer's footer second) flashed its head back to 4 of 6. The mod draws the band once more itself
  async cc_done_slide_is_drawn_out(E) {
    await create(E, 't', [S('One', st('A', 'active'), 'B', 'C'), S('Two', 'D', 'E', 'F')])
    for (let i = 0; i < 4; i++) await E.call({ id: 't', next: true })
    await E.view('t')
    await E.call({ id: 't', state: 'done' })
    const done = (await E.view('t')).track
    const before = tickOf(E)
    E.tick(500)
    await E.fireTimers()
    const isRedrawn = tickOf(E) !== before
    const last = (await E.view('t')).track
    const settled = tickOf(E)
    E.tick(1000)
    await E.fireTimers()
    const isOnce = tickOf(E) === settled
    const isGlide = s => s.includes('<animate attributeName="width"')
    return [
      `slide at done ${isGlide(done)}; drawn again after it ${isRedrawn}, that answer slides ${isGlide(last)}, then left alone ${isOnce}`,
      isGlide(done) && isRedrawn && !isGlide(last) && isOnce,
    ]
  },
  // cc-mods: the same for the last agent's strip on a finished bar: its morph to done flashed the old word on each
  // repaint until the strips folded 5 s later
  async cc_last_strip_morph_is_drawn_out(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    await E.call({ id: 't', state: 'done' })
    await E.view('t')
    E.tick(1000)
    await E.fireTimers()
    await E.view('t')
    await E.turnComplete('ag1')
    const at = (await E.view('t')).strips[0] ?? ''
    const before = tickOf(E)
    E.tick(500)
    await E.fireTimers()
    const isRedrawn = tickOf(E) !== before
    const last = (await E.view('t')).strips[0] ?? ''
    const isMorph = s => s.includes(' mo ') || s.includes('<animate ')
    return [`morph at the finish ${isMorph(at)}; drawn again after it ${isRedrawn}, that answer morphs ${isMorph(last)}`, isMorph(at) && isRedrawn && !isMorph(last)]
  },
  async running_pill_has_live_clock(E) {
    await create(E)
    E.tick(83_000)
    await E.call({ id: 't', next: true })
    const src = (await E.view('t')).overlay
    return [`clock ${src.includes('class="kc0 ')}, reads ${clock(src)}`, src.includes('class="kc0 ') && clock(src) === '1m 23s' && !src.includes('{{T:')]
  },
  async done_pill_static_time(E) {
    await create(E)
    E.tick(125_000)
    await E.call({ id: 't', state: 'done' })
    const src = (await E.view('t')).source
    return [`2m 5s ${src.includes('2m 5s')}, no clock ${!src.includes('class="kc0 ')}`, src.includes('2m 5s') && !src.includes('class="kc0 ')]
  },
  // cc-mods: the desktop shows a band's last answer again on repaints that never reach the mod (another plugin's redraw
  // each second, a tool's timer), restarting its pictures. A clock that ran by itself in CSS started over at the time
  // of that answer, a second back at every repaint ("1m 23s", "1m 24s", "1m 23s"). A running clock is text the answer
  // holds as drawn, and the mod draws the band again on each wall-clock second while one shows
  async cc_repaint_never_steps_a_clock_back(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    await E.view('t')
    E.tick(83_400)
    const before = tickOf(E)
    await E.fireTimers() // the beat just after the next wall-clock second
    const isRedrawn = tickOf(E) !== before
    const v = await E.view('t') // that redraw: the answer every later repaint shows again
    const runsByItself = s => s.includes('--d:') || /animation:[^;}]*var\(--d\)/.test(s)
    return [
      `redrawn on the second ${isRedrawn}; strip reads ${clock(v.strips[0])}, pill ${clock(v.overlay)}; a clock running by itself ${runsByItself(v.strips[0] + v.overlay)}`,
      isRedrawn && clock(v.strips[0]) === '1m 23s' && clock(v.overlay) === '1m 23s' && !runsByItself(v.strips[0] + v.overlay),
    ]
  },
  // cc-mods: the beat draws the band again only while a running clock shows: a finished bar's time stands still
  async cc_no_beat_without_a_running_clock(E) {
    await create(E)
    E.tick(5000)
    await E.call({ id: 't', state: 'done' })
    await E.view('t')
    const before = tickOf(E)
    E.tick(1000)
    await E.fireTimers()
    const isIdle = tickOf(E) === before
    await create(E, 'u', three(), 'Other') // a running bar: its pill carries the time on hover
    await E.view('u')
    await E.fireTimers()
    const isLive = tickOf(E) !== before
    return [`done bar alone redrawn ${!isIdle}, with a running bar ${isLive}`, isIdle && isLive]
  },
  async strips_clock_live_then_static(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    E.tick(12_000)
    const live = (await E.view('t')).source.includes('class="sc ')
    await E.turnComplete('ag1')
    const src = (await E.view('t')).source
    return [`live ${live}, finished shows 12s ${src.includes('>12s<')}`, live && src.includes('>12s<') && !src.includes('class="sc ')]
  },
  async agent_change_redraws_only_its_strip(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    await E.spawn('ag2', 'Read docs')
    // cc-mods: two running agents fold into one summary row; opened out, each has its own strip again
    await E.press('agents-t')
    const a = await E.view('t')
    await E.agentTool('ag1', 'Grep')
    const b = await E.view('t')
    const same = a.track === b.track && a.strips[1] === b.strips[1]
    return [`track and other strip kept ${same}, own strip redrawn ${a.strips[0] !== b.strips[0]}`, same && a.strips[0] !== b.strips[0]]
  },
  async strip_names_model_and_effort(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    const before = (await E.view('t')).strips[0]
    await E.step('ag1', 'low')
    const after = (await E.view('t')).strips[0]
    return [`model ${before.includes('(haiku 4.5)')}, effort ${after.includes('(haiku 4.5 · low)')}`, before.includes('(haiku 4.5)') && after.includes('(haiku 4.5 · low)')]
  },
  // cc-mods: a strip names the agent definition before the model, and the context its last request carried
  async cc_strip_shows_role_and_context(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests', undefined, 'worker', 'claude-sonnet-5-5')
    const before = (await E.view('t')).strips[0]
    await E.step('ag1', 'high', { input_tokens: 8, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 2_000, output_tokens: 300 }, 'claude-sonnet-5-5')
    const running = (await E.view('t')).strips[0]
    const alt = (await E.svgs()).some(p => p.alt === 'agent Scan tests: running, Starting, ctx 42k')
    await E.turnComplete('ag1')
    const done = (await E.view('t')).strips[0]
    const role = running.includes('(worker · sonnet 5.5 · high)')
    const ctx = !before.includes('ctx ') && running.includes('>ctx 42k<') && done.includes('>ctx 42k<')
    // a window the model id does not name is no share of anything
    const noShare = !/ctx [^<]*%/.test(running)
    return [`role ${role}, ctx none→42k, kept when done ${ctx}, no share ${noShare}, alt ${alt}`, role && ctx && noShare && alt]
  },
  // cc-mods: the share shows where the id names the window ([1m]); a plugin's agent drops its plugin's prefix
  async cc_context_share_for_a_named_window(E) {
    await create(E)
    await E.spawn('ag1', 'Review', undefined, 'pstack:poteto-agent', 'claude-opus-5-5[1m]')
    await E.step('ag1', 'xhigh', { cache_read_input_tokens: 250_000 }, 'claude-opus-5-5[1m]')
    const s = (await E.view('t')).strips[0]
    const ok = s.includes('>ctx 250k · 25%<') && s.includes('(poteto-agent · opus 5.5 · xhigh)')
    return [`share ${s.includes('>ctx 250k · 25%<')}, role ${s.includes('(poteto-agent · opus 5.5 · xhigh)')}`, ok]
  },
  // cc-mods: the main thread's requests and a response without usage leave the strips alone
  async cc_context_only_from_agent_responses(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests')
    await E.step(undefined, 'high', { cache_read_input_tokens: 90_000 })
    await E.step('ag1', 'low')
    const s = (await E.view('t')).strips[0]
    return [`ctx drawn ${s.includes('ctx ')}`, !s.includes('ctx ')]
  },
  // cc-mods: the terminal strip carries the same context count before the time
  async cc_terminal_strip_shows_context(E) {
    await create(E)
    await E.spawn('ag1', 'Scan tests', undefined, 'Explore')
    await E.step('ag1', 'low', { input_tokens: 1_200 })
    const raster = (await E.terminal(120)).find(n => n.type === 'Raster' && n.props.key === 'strips-t')
    const row = raster ? glyphs(raster.props.cells) : ''
    const ok = /ctx 1k +0s/.test(row) && row.includes('(Explore · haiku 4.5 · low)')
    return [`row "${row.replace(/[⠀-⣿]/g, '·').trim()}"`, ok]
  },
  // cc-mods: the band is repainted each wall-clock second, which starts every endless CSS loop over; a loop that whole
  // seconds divide is at its first frame then anyway, so the restart does not show
  async cc_loops_divide_the_second(E) {
    await create(E)
    E.tick(400)
    await E.call({ id: 't', next: true })
    await E.spawn('ag1', 'Scan tests')
    E.tick(1000)
    const sources = (await E.svgs()).map(p => p.source).join('')
    const loops = [...sources.matchAll(/animation(?:-duration)?:\s*(?:[a-z]+\s+)?([\d.]+)(m?s)[^;}]*/g)]
      .filter(m => /infinite/.test(m[0]) || m[0].startsWith('animation-duration'))
      .map(m => Math.round(Number(m[1]) * (m[2] === 's' ? 1000 : 1)))
    const bad = loops.filter(ms => 1000 % ms !== 0)
    return [`loops ${loops.join(', ') || 'none'} ms; not dividing a second: ${bad.join(', ') || 'none'}`, loops.length >= 2 && bad.length === 0]
  },
  async bars_survive_a_restart(E) {
    const kept = new Map()
    const first = await boot('./register.mjs', kept)
    await create(first)
    await first.spawn('ag1', 'Scan tests')
    await first.call({ id: 't', next: true })
    await first.everyTick()
    const second = await boot('./register.mjs', kept)
    const bar = second.bar('t')
    const ok = !!bar && second.steps('t') === first.steps('t') && (bar.agents ?? []).length === 0
    return [`restored ${!!bar}, same steps ${bar ? second.steps('t') === first.steps('t') : false}, strips dropped ${bar ? (bar.agents ?? []).length === 0 : false}`, ok]
  },
  // cc-mods: a finished bar holds still (upstream twinkled it like a running one)
  async cc_done_bar_is_still(E) {
    await create(E)
    await E.call({ id: 't', state: 'done' })
    const src = (await E.view('t')).track
    return [`twinkle ${/class="b\d t\d"/.test(src)}, dots ${/class="b\d"/.test(src)}`, !/class="b\d t\d"/.test(src) && /class="b\d"/.test(src)]
  },
  // cc-mods: a running bar twinkles only in the last stretch behind its head
  async cc_running_bar_twinkles_only_at_head(E) {
    await create(E)
    await E.call({ id: 't', next: true })
    const src = (await E.view('t')).track
    const fx = Number(src.match(/<clipPath id="fill"><rect width="([\d.]+)"/)?.[1])
    const xs = [...src.matchAll(/<path class="b\d t\d" d="([^"]*)"/g)].flatMap(m => [...m[1].matchAll(/M([\d.]+) /g)].map(x => Number(x[1])))
    const still = /<path class="b\d" d=/.test(src)
    const nearHead = xs.length > 0 && xs.every(x => x >= fx - 48 - 3)
    return [`fill ${fx}px, ${xs.length} twinkling dots from x=${Math.min(...xs)}, still dots ${still}`, nearHead && still]
  },
  // cc-mods: strips fold by default; a waiting or failed agent keeps its strip, the rest share one summary row
  async cc_strips_fold_by_default(E) {
    await create(E)
    await E.spawn('ag1', 'Lone agent')
    const lone = await E.view('t')
    const loneOk = lone.strips.length === 1 && lone.strips[0].includes('Lone agent') && !(await E.buttons()).some(b => b.key === 'agents-t')
    for (const id of ['ag2', 'ag3', 'ag4']) await E.spawn(id, `Agent ${id}`)
    await E.turnComplete('ag2', 'error')
    const folded = await E.view('t')
    const btn = (await E.buttons()).find(b => b.key === 'agents-t')
    const foldedOk = folded.strips.length === 2 && folded.strips[0].includes('Agent ag2') && folded.strips[1].includes('3 more agents · 3 running') && btn?.label === '▾ 4'
    await E.press('agents-t')
    const open = await E.view('t')
    const openOk = open.strips.length === 4 && (await E.buttons()).find(b => b.key === 'agents-t')?.label === '▴'
    await E.press('agents-t')
    const back = (await E.view('t')).strips.length === 2
    return [`lone ${loneOk}, folded ${folded.strips.length} rows (${btn?.label}), opened ${open.strips.length}, folded again ${back}`, loneOk && foldedOk && openOk && back]
  },
  // cc-mods: the ▾ sits in the title row. Moved to the end of the last agent row, inside the track's column, the
  // desktop's native button came out far wider than its room: the column widened and pushed the bar's title, percent
  // and ✕ out of the band. The track's column holds drawings alone, each as wide as the track
  async cc_fold_button_stays_out_of_the_track_column(E) {
    await create(E)
    for (const id of ['ag1', 'ag2', 'ag3']) await E.spawn(id, `Agent ${id}`)
    const check = async () => {
      const tree = await E.tree()
      const bar = nodes(tree, n => n.type === 'Box' && n.props.key === 'bar-t')[0]
      const row = (bar?.children ?? []).flat()
      const column = row.find(n => n?.type === 'Box' && n.props.flexDirection === 'column')
      const inColumn = nodes(column?.children ?? [], () => true).map(n => n.type)
      const track = nodes(column?.children ?? [], n => n.type === 'Svg')[0]?.props.width
      const strips = nodes(column?.children ?? [], n => n.type === 'Svg' && String(n.props.key).startsWith('strip-t-')).map(n => n.props.width)
      return {
        byTitle: row.some(n => n?.type === 'Button' && n.props.key === 'agents-t'),
        onlyDrawings: inColumn.every(t => t === 'Box' || t === 'Svg'),
        sameWidth: strips.length > 0 && strips.every(w => w === track),
      }
    }
    const folded = await check()
    await E.press('agents-t')
    const open = await check()
    return [
      `folded ${JSON.stringify(folded)}; opened ${JSON.stringify(open)}`,
      [folded, open].every(c => c.byTitle && c.onlyDrawings && c.sameWidth),
    ]
  },
  // cc-mods: the agents button appearing with a second agent leaves the track width alone
  async cc_track_width_steady_when_button_appears(E) {
    await create(E)
    await E.spawn('ag1', 'One')
    const a = (await E.svgs()).find(v => v.alt.startsWith('Task:'))?.width
    await E.spawn('ag2', 'Two')
    const hasButton = (await E.buttons()).some(b => b.key === 'agents-t')
    const b = (await E.svgs()).find(v => v.alt.startsWith('Task:'))?.width
    return [`width ${a} → ${b}, button ${hasButton}`, a === b && hasButton]
  },
  // cc-mods: a finished bar leaves on its own after a minute; a failed one stays for the person to read
  async cc_done_bar_leaves_after_linger(E) {
    await create(E)
    await create(E, 'bad', [S('X', st('Y', 'active'))], 'Broken')
    await E.call({ id: 't', state: 'done' })
    await E.call({ id: 'bad', failed: 'Y', note: 'tests failed' })
    E.tick(59_000)
    await E.everyTick()
    const early = E.plans().map(p => p.id).join(',')
    E.tick(2_000)
    await E.everyTick()
    const late = E.plans().map(p => p.id).join(',')
    E.tick(120_000)
    await E.everyTick()
    const later = E.plans().map(p => p.id).join(',')
    return [`59s: ${early}; 61s: ${late}; 3m: ${later}`, early === 't,bad' && late === 'bad' && later === 'bad']
  },
  async pill_covers_checkpoints(E) {
    await create(E)
    const src = (await E.view('t')).overlay
    const hit = src.indexOf('class="h'), pill = src.indexOf('<g transform="translate('), tip = src.indexOf('class="tp')
    return [`hit ${hit} < pill ${pill} < tip ${tip}`, hit > 0 && hit < pill && pill < tip]
  },
  // cc-mods: a sound only when the person is needed; agents finishing or failing stay quiet
  async cc_agents_finish_and_fail_quietly(E) {
    await E.spawn('ag1', 'Scan') // no task bar yet: the mod's own Agents bar
    await E.spawn('ag2', 'Read')
    await E.turnComplete('ag1')
    await E.turnComplete('ag2', 'error')
    await create(E)
    await E.spawn('ag3', 'Check') // on the task bar
    await E.turnComplete('ag3', 'aborted')
    return [`sounds ${JSON.stringify(E.sounds)}`, E.sounds.length === 0]
  },
  async cc_agent_held_on_approval_is_quiet_unless_asked(E) {
    // held on a check the person never sees (the mode, a hook, the main agent): strip turns amber, no sound
    await create(E)
    await E.spawn('ag1', 'Scan')
    await E.approval('ag1')
    await E.agentTool('ag1', 'Read')
    return [`sounds ${JSON.stringify(E.sounds)}`, E.sounds.length === 0]
  },
  async cc_permission_prompt_to_the_person_sounds(E) {
    await E.notify('permission_prompt', 'ag1') // an agent's dialog left waiting on the person
    await E.notify('permission_prompt') // the main thread's
    await E.notify('idle_prompt') // not a question
    const want = '["sounds/decision.wav","sounds/decision.wav"]'
    return [`sounds ${JSON.stringify(E.sounds)}`, JSON.stringify(E.sounds) === want]
  },
  async cc_main_plan_still_sounds(E) {
    await create(E)
    await E.call({ id: 't', state: 'needs_input', note: 'Pick one' })
    await E.call({ id: 't', state: 'running' })
    await E.call({ id: 't', failed: 'A', note: 'Broke' })
    await E.call({ id: 't', state: 'done' })
    const want = '["sounds/decision.wav","sounds/error.wav","sounds/done.wav"]'
    return [`sounds ${JSON.stringify(E.sounds)}`, JSON.stringify(E.sounds) === want]
  },
  async stop_still_blocks_open_bar(E) {
    await E.turnStart()
    await create(E)
    await E.work('Edit')
    const r = await E.stop('All set.')
    return [`${r.block ? 'blocked' : 'passes'}`, !!r.block]
  },
  async terminal_bar_is_a_raster_that_fits(E) {
    await create(E)
    const out = []
    for (const cols of [120, 60]) {
      const nodes = await E.terminal(cols)
      const r = nodes.find(n => n.type === 'Raster' && n.props.key === 'track-t')
      const row = glyphs(r.props.cells)
      out.push({ cols, w: r.props.columns, row })
    }
    const fits = out.every(o => o.w + 'Task'.length + 13 <= o.cols)
    return [out.map(o => `${o.cols}: ${o.row.trim()}`).join(' | '), fits && out.every(o => o.row.includes('One 1/2'))]
  },
  async terminal_animates_by_blits(E) {
    await E.turnStart()
    await create(E)
    await E.call({ id: 't', next: true })
    await E.terminal(120)
    const frames = []
    for (let i = 0; i < 10; i++) {
      E.tick(100)
      await E.everyTick()
      frames.push(E.blits.filter(b => b.key === 'track-t').at(-1)?.cells)
    }
    const distinct = new Set(frames.filter(Boolean)).size
    return [`${E.blits.length} blits, ${distinct} distinct frames`, distinct > 1]
  },
  async frame_clock_only_with_a_moving_terminal_bar(E) {
    await E.turnStart()
    await create(E)
    await E.svgs()
    await E.everyTick()
    const desktop = E.frameTimers()
    await E.terminal(120)
    await E.everyTick()
    const terminal = E.frameTimers()
    return [`desktop ${desktop}, terminal ${terminal}`, desktop === 0 && terminal === 1]
  },
  async terminal_bar_stands_still_after_the_turn(E) {
    await E.turnStart()
    await create(E)
    await E.terminal(120)
    await E.everyTick()
    const during = E.frameTimers()
    await E.turnComplete(undefined)
    E.tick(1000)
    await E.everyTick()
    const before = E.blits.length
    E.tick(100)
    await E.everyTick()
    const after = E.frameTimers()
    return [`timer during turn ${during}, after ${after}, blits after ${E.blits.length - before}`, during === 1 && after === 0 && E.blits.length === before]
  },
  async waiting_bar_stands_still(E) {
    await E.turnStart()
    await create(E)
    await E.call({ id: 't', state: 'needs_input', note: 'Pick one' })
    await E.terminal(120)
    E.tick(1000)
    await E.everyTick()
    return [`frame timers ${E.frameTimers()}`, E.frameTimers() === 0]
  },
  async closed_bar_forgets_its_glide(E) {
    await E.turnStart()
    await create(E)
    await E.terminal(120)
    await E.call({ id: 't', next: true })
    await E.terminal(120)
    E.tick(1000)
    await E.terminal(120)
    await E.command('progress-clear')
    await create(E)
    const row = (await E.terminal(120)).find(n => n.type === 'Raster' && n.props.key === 'track-t')
    // a fresh bar at step 1 has no fill, so its pill sits at the left edge instead of sliding back from the old head
    const first = glyphs(row.props.cells).indexOf('One')
    return [`pill text at column ${first}`, first >= 0 && first <= 2]
  },
  // cc-mods: the main thread often starts an agent and only then opens the bar for that work; the agent sat on the
  // Agents bar beside the task bar for good. One started this turn moves onto the bar opened after it; one from an
  // earlier turn stays where it is
  async cc_turn_agents_join_the_bar_opened_after_them(E) {
    await E.turnStart()
    await E.spawn('ag0', 'Earlier work')
    await E.turnStart()
    await E.spawn('ag1', 'Build page')
    await create(E)
    await E.agentTool('ag1', 'Bash') // its strip is found on the bar it moved to
    const on = id => (E.bar(id)?.agents ?? []).map(a => `${a.id}:${a.tool}`).join(',')
    return [`t [${on('t')}], agents bar [${on('agents:auto')}]`, on('t') === 'ag1:Bash' && on('agents:auto') === 'ag0:Starting']
  },
  // a bar an agent opens for its own work, or one opened already finished, leaves the main thread's agents be
  async cc_only_an_open_main_bar_adopts(E) {
    await E.turnStart()
    await E.spawn('ag1', 'Build page')
    await E.call({ id: 'sub', title: 'Sub', stages: three(), agentId: 'ag1' })
    await E.call({ id: 'old', title: 'Old', stages: [S('One', st('A', 'done'))] })
    const on = id => (E.bar(id)?.agents ?? []).map(a => a.id).join(',')
    return [`sub [${on('sub')}], old [${on('old')}], agents bar [${on('agents:auto')}]`, on('sub') === '' && on('old') === '' && on('agents:auto') === 'ag1']
  },
  async cc_agents_bar_goes_once_emptied(E) {
    await E.turnStart()
    await E.spawn('ag1', 'Build page')
    await create(E)
    return [`bars ${E.plans().map(p => p.id).join(', ')}`, E.plans().length === 1 && E.bar('t')?.agents?.length === 1]
  },
  // cc-mods: the Agents bar has no progress to show: an agent reports none, and a count of finished agents sat at 0%
  // until the last one ended. The bar draws its strips alone, with no track, pill or percent, on either surface
  async cc_agents_bar_draws_strips_alone(E) {
    await E.spawn('ag1', 'Build page')
    const tree = await E.tree()
    const svgs = nodes(tree, n => n.type === 'Svg').map(n => n.props)
    const track = svgs.some(p => p.alt.startsWith('Agents:'))
    const strips = svgs.filter(p => String(p.key ?? '').startsWith('strip-agents:auto-')).length
    const percent = nodes(tree, n => n.type === 'Text' && n.children.join('').includes('%')).length
    const term = await E.terminal(120)
    const termTrack = term.some(n => n.type === 'Raster' && n.props.key === 'track-agents:auto')
    const termStrips = term.some(n => n.type === 'Raster' && n.props.key === 'strips-agents:auto')
    const termPercent = term.some(n => n.type === 'Text' && n.children.join('').includes('%'))
    return [
      `desktop: track ${track}, ${strips} strip, percent ${percent}; terminal: track ${termTrack}, strips ${termStrips}, percent ${termPercent}`,
      !track && strips === 1 && percent === 0 && !termTrack && termStrips && !termPercent,
    ]
  },
  // with nothing but folded strips to show, the Agents bar leaves with them instead of lingering a minute
  async cc_agents_bar_leaves_with_its_strips(E) {
    await E.spawn('ag1', 'Build page')
    await E.turnComplete('ag1')
    E.tick(1000)
    await E.everyTick()
    const during = !!E.bar('agents:auto')
    E.tick(5000)
    await E.everyTick()
    return [`a second after the agent ${during}, six seconds after ${!!E.bar('agents:auto')}`, during && !E.bar('agents:auto')]
  },
  async strip_tool_sits_right_and_name_keeps_its_model(E) {
    await create(E)
    await E.spawn('ag1', 'Review Python backend architecture')
    await E.step('ag1', 'high')
    await E.agentTool('ag1', 'Read')
    const desk = (await E.view('t')).strips[0]
    const full = desk.includes('Review Python backend architecture<tspan class="st"> (haiku 4.5 · high)</tspan>')
    const anchored = /text-anchor="end"[^>]*>Read</.test(desk)
    const r = (await E.terminal(110)).find(n => n.type === 'Raster' && n.props.key === 'strips-t')
    const row = glyphs(r.props.cells).replace(/[⠀-⣿]/g, ' ')
    // cc-mods: the context's room sits between the tool word and the time, blank until the first count
    const term = /architecture \(haiku 4\.5 · high\) +Read +\d+s/.test(row)
    return [`desktop full name ${full}, tool at right ${anchored}, terminal ${term}`, full && anchored && term]
  },
  async agents_make_no_sounds(E) {
    // agents with no task bar open land on the mod's own Agents bar, whose state follows them
    await E.spawn('ag1', 'Scan tests')
    await E.spawn('ag2', 'Read docs')
    await E.agentTool('ag1', 'Read')
    // ag2 waits on an approval: its strip and the Agents bar turn amber
    const held = await E.hold('ag2')
    E.tick(700)
    await E.fireTimers()
    const waited = E.bar('agents:auto')?.state
    await held.release()
    await E.turnComplete('ag1', 'error')
    await E.turnComplete('ag2')
    E.tick(1000)
    await E.fireTimers()
    // and on a task bar: a failed agent
    await create(E)
    await E.spawn('ag3', 'Build')
    await E.turnComplete('ag3', 'error')
    return [`sounds ${E.sounds.length ? E.sounds.join(', ') : 'none'}; agents bar while waiting ${waited}`, E.sounds.length === 0 && waited === 'needs_input']
  },
  async agent_bar_calls_and_questions_are_silent(E) {
    await create(E)
    await E.call({ id: 't', state: 'needs_input', note: 'which one?', agentId: 'ag1' })
    await E.call({ id: 't', state: 'error', note: 'failed', agentId: 'ag1' })
    await E.call({ id: 't', state: 'running', agentId: 'ag1' })
    await E.ask('ag1')
    const agentSounds = E.sounds.length
    const stateAfterAgentAsk = E.bar('t').state
    await E.call({ id: 't', state: 'needs_input', note: 'which one?' })
    await E.call({ id: 't', state: 'running' })
    await E.ask()
    return [`agent ${agentSounds} sounds, bar after agent question ${stateAfterAgentAsk}; main ${E.sounds.join(', ')}`, agentSounds === 0 && stateAfterAgentAsk === 'running' && E.sounds.length === 2]
  },
  // cc-mods: the footer has no button at all (footer_left_to_the_engine); the band keeps upstream's rule
  async terminal_buttons_only_where_clicks_land(E) {
    await create(E)
    const band = async fs => (await E.terminal(120, fs)).filter(n => n.type === 'Button').length
    const r = [await band(false), await band(true)]
    return [`band ${r[0]}/${r[1]}`, r.join() === '0,1']
  },
  // cc-mods: folding is the desktop's (it has the ▾ button); the terminal has none, so it shows every strip it has room for
  async cc_terminal_strips_do_not_fold(E) {
    await create(E)
    for (const id of ['ag1', 'ag2', 'ag3']) await E.spawn(id, `Agent ${id}`)
    const strips = (await E.terminal(120)).find(n => n.type === 'Raster' && n.props.key === 'strips-t')
    return [`terminal strip rows ${strips?.props.rows}`, strips?.props.rows === 3]
  },
  async desktop_still_draws_svg(E) {
    await create(E)
    const svgs = await E.svgs()
    const term = await E.terminal(120)
    return [`${svgs.length} svg, ${term.filter(n => n.type === 'Svg').length} svg in terminal`, svgs.length > 0 && !term.some(n => n.type === 'Svg')]
  },
}

let failed = 0
for (const [id, fn] of Object.entries(C)) {
  const E = await boot(file)
  let observed, ok
  try {
    ;[observed, ok] = await fn(E)
  } catch (err) {
    ;[observed, ok] = ['THREW ' + (err?.stack ?? err), false]
  }
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(32)} ${observed}`)
}
console.log(failed ? `${failed} failed` : 'all passed')
process.exitCode = failed ? 1 : 0
