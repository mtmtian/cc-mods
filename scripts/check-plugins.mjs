import assert from 'node:assert/strict'
import { cpSync, existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
const marketplace = readJson(join(root, '.claude-plugin/marketplace.json'))
const plugins = marketplace.plugins
assert(Array.isArray(plugins) && plugins.length > 0, 'The marketplace must list its plugins')

const names = new Set()
for (const { name, source } of plugins) {
  assert(typeof name === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name), `Invalid plugin name: ${name}`)
  assert(!names.has(name), `Duplicate marketplace plugin: ${name}`)
  names.add(name)
  assert.equal(source, `./mods/${name}/plugins/${name}`, `Unexpected source for ${name}`)
  const manifest = readJson(join(root, source, '.claude-plugin/plugin.json'))
  assert.equal(manifest.name, name, `Marketplace/manifest name mismatch for ${name}`)
  assert(existsSync(join(root, 'mods', name, 'LICENSE')), `Missing license for ${name}`)
}
assert.deepEqual(
  globSync('mods/*/plugins/*/.claude-plugin/plugin.json', { cwd: root }).sort(),
  plugins.map(({ source }) => `${source.slice(2)}/.claude-plugin/plugin.json`).sort(),
  'Every plugin must be listed in the root marketplace',
)

// Work on disposable copies: Claude writes build-specific declarations and a tsconfig.
// Inherit only OS essentials, never the caller's API keys or provider configuration.
const scratch = mkdtempSync(join(tmpdir(), 'cc-mods-plugins-'))
const env = Object.fromEntries(
  ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SystemRoot']
    .filter(key => process.env[key] !== undefined)
    .map(key => [key, process.env[key]]),
)
Object.assign(env, {
  CI: 'true',
  CLAUDE_CONFIG_DIR: join(scratch, 'config'),
  CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  // A future CLI must fail, rather than make a real model request for /cost.
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
})
const claude = join(root, 'node_modules/.bin/claude')
const tsc = join(root, 'node_modules/typescript/bin/tsc')
function run(command, args) {
  console.log(`\n> ${command === claude ? 'claude' : 'node'} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: scratch, env, stdio: ['ignore', 'inherit', 'inherit'], timeout: 60_000,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `Command failed (signal: ${result.signal ?? 'none'})`)
}

try {
  mkdirSync(join(scratch, '.claude-plugin'))
  cpSync(join(root, '.claude-plugin/marketplace.json'), join(scratch, '.claude-plugin/marketplace.json'))
  for (const { source } of plugins) {
    cpSync(join(root, source), join(scratch, source), { recursive: true })
    // Always generate declarations for the locked CLI, even after a local development session.
    rmSync(join(scratch, source, '.claude-plugin/types'), { recursive: true, force: true })
    rmSync(join(scratch, source, 'tsconfig.json'), { force: true })
  }
  run(claude, ['--bare', 'plugin', 'validate', '--strict', '.'])
  for (const { name, source } of plugins) {
    console.log(`\nChecking ${name}`)
    run(claude, ['--bare', 'plugin', 'validate', '--strict', source])
    // plan-progress is exercised by its stub-engine regression suite in `npm test`.
    if (name !== 'plan-progress') {
      assert(globSync('**/*.test.{ts,tsx}', { cwd: join(scratch, source) }).length > 0,
        `No native hook tests found for ${name}`)
      run(claude, ['plugin', 'test', source])
    }
    // /cost is a built-in local command. --bare cannot be used here: it disables
    // function hooks, including SDK generation. Use the isolated config instead.
    run(claude, ['--setting-sources', '', '--strict-mcp-config',
      '--no-session-persistence', '--tools', 'Read', '--plugin-dir', source, '-p', '/cost'])
    assert(existsSync(join(scratch, source, 'tsconfig.json')), `No generated tsconfig for ${name}`)
    run(process.execPath, [tsc, '--noEmit', '--strict', '--noUncheckedIndexedAccess', '-p', source])
  }
  console.log(`\nAll ${plugins.length} plugins passed validation, hook checks and type checking.`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
