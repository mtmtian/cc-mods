// the audit's cases after the fixes: each check states the behaviour the mod should have now
import { boot, S, st } from './engine.mjs'

const file = process.argv[2] ?? './register.mjs'
const three = () => [S('One', st('A', 'active'), 'B'), S('Two', 'C')]
const create = (E, id = 't', stages = three(), title = 'Task') => E.call({ id, title, stages })
const res = r => r.deny ?? r.result
const pct = async (E, id) => (await E.view(id)).alt.match(/\d+%/)?.[0]

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
    const lum = h => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const onWhite = h => 1.05 / (lum(h) + 0.05)
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
    // the still parts: the track picture and the strips (the hover layer is rebuilt every redraw by design)
    const still = v => v.track + v.strips.join('')
    const a = still(await E.view('t'))
    E.tick(7000)
    const b = still(await E.view('t'))
    await E.agentTool('ag1', 'Grep')
    const c = still(await E.view('t'))
    return [`idle redraw same ${a === b}, change redraws ${a !== c}`, a === b && a !== c]
  },
  async running_pill_has_live_clock(E) {
    await create(E)
    E.tick(83_000)
    await E.call({ id: 't', next: true })
    const src = (await E.view('t')).overlay
    const delay = src.match(/--d:-([\d.]+)s/)?.[1]
    return [`clock ${src.includes('class="kc0 ')}, delay ${delay}s`, src.includes('class="kc0 ') && delay === '83.0' && !src.includes('{{T:')]
  },
  async done_pill_static_time(E) {
    await create(E)
    E.tick(125_000)
    await E.call({ id: 't', state: 'done' })
    const src = (await E.view('t')).source
    return [`2m 5s ${src.includes('2m 5s')}, no clock ${!src.includes('class="kc0 ')}`, src.includes('2m 5s') && !src.includes('class="kc0 ')]
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
  async stop_still_blocks_open_bar(E) {
    await E.turnStart()
    await create(E)
    await E.work('Edit')
    const r = await E.stop('All set.')
    return [`${r.block ? 'blocked' : 'passes'}`, !!r.block]
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
