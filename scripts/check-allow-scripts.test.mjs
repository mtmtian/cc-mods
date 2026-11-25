import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = join(root, 'scripts/check-allow-scripts.mjs')
const readJson = name => JSON.parse(readFileSync(join(root, name), 'utf8'))

const scratch = mkdtempSync(join(tmpdir(), 'check-allow-scripts-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

function run(change = () => {}) {
  const packageJson = structuredClone(readJson('package.json'))
  const lock = structuredClone(readJson('package-lock.json'))
  change(packageJson, lock)
  const target = mkdtempSync(join(scratch, 'case-'))
  writeFileSync(join(target, 'package.json'), JSON.stringify(packageJson))
  writeFileSync(join(target, 'package-lock.json'), JSON.stringify(lock))
  const result = spawnSync(process.execPath, [script, target], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const renameKey = (allowScripts, from, to) => {
  const value = allowScripts[from]
  delete allowScripts[from]
  allowScripts[to] = value
}

const nestedBun = lock => {
  lock.packages['node_modules/x'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz' }
  lock.packages['node_modules/x/node_modules/bun'] = {
    ...lock.packages['node_modules/bun'],
    version: '1.4.5',
    resolved: 'https://registry.npmjs.org/bun/-/bun-1.4.5.tgz',
  }
}

describe('check-allow-scripts', () => {
  it('passes for this repository as it is', () => {
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /@anthropic-ai\/claude-code@2\.1\.311, bun@1\.4\.4/)
  })

  it('fails and names the new key when Dependabot bumps bun', () => {
    const result = run(pkg => renameKey(pkg.allowScripts, 'bun@1.4.4', 'bun@1.4.3'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"bun@1\.4\.3"/)
    assert.match(result.stderr, /locks bun with an install script at 1\.4\.4/)
    assert.match(result.stderr, /change the key to "bun@1\.4\.4"/)
  })

  it('fails and names the new key when a scoped package version differs', () => {
    const result = run(pkg => renameKey(pkg.allowScripts, '@anthropic-ai/claude-code@2.1.311', '@anthropic-ai/claude-code@2.1.310'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"@anthropic-ai\/claude-code@2\.1\.310"/)
    assert.match(result.stderr, /change the key to "@anthropic-ai\/claude-code@2\.1\.311"/)
  })

  it('fails and asks to remove a key for a package the lockfile does not have', () => {
    const result = run(pkg => {
      pkg.allowScripts['left-pad@1.3.0'] = true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"left-pad@1\.3\.0": left-pad is not in package-lock\.json\. Remove this key\./)
  })

  it('fails and asks to remove a key for a locked package without an install script', () => {
    const result = run(pkg => {
      pkg.allowScripts['typescript@7.0.2'] = true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"typescript@7\.0\.2": package-lock\.json has no install script for typescript@7\.0\.2\. Remove this key\./)
  })

  it('fails and tells how to add a missing approval', () => {
    const result = run(pkg => {
      delete pkg.allowScripts['bun@1.4.4']
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /bun@1\.4\.4 has an install script and no allowScripts entry/)
    assert.match(result.stderr, /add "bun@1\.4\.4": true/)
  })

  it('fails when allowScripts is absent and the lockfile has install scripts', () => {
    const result = run(pkg => {
      delete pkg.allowScripts
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /add "bun@1\.4\.4": true/)
    assert.match(result.stderr, /add "@anthropic-ai\/claude-code@2\.1\.311": true/)
  })

  for (const key of ['bun', 'bun@^1.4.4', 'bun@latest', 'bun@v1.4.4']) {
    it(`fails on the non-exact key ${key}`, () => {
      const result = run(pkg => renameKey(pkg.allowScripts, 'bun@1.4.4', key))
      assert.equal(result.status, 1)
      assert.match(result.stderr, new RegExp(`"${key.replace(/[\\^]/g, '\\$&')}": not an exact-version key`))
      assert.match(result.stderr, /Use "bun@1\.4\.4"/)
    })
  }

  it('accepts one key listing every locked version joined with ||', () => {
    const result = run((pkg, lock) => {
      nestedBun(lock)
      renameKey(pkg.allowScripts, 'bun@1.4.4', 'bun@1.4.4 || 1.4.5')
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails and names both versions when one of two locked versions is approved', () => {
    const result = run((pkg, lock) => nestedBun(lock))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /locks bun with an install script at 1\.4\.4, 1\.4\.5/)
    assert.match(result.stderr, /change the key to "bun@1\.4\.4 \|\| 1\.4\.5"/)
  })

  it('does not ask for approval of a bundled package with an install script', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/bundled'] = {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/bundled/-/bundled-1.0.0.tgz',
        hasInstallScript: true,
        inBundle: true,
      }
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails on an install script in a package that does not come from the registry', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/from-git'] = {
        version: '1.0.0',
        resolved: 'git+ssh://git@github.com/example/from-git.git#0123456789abcdef0123456789abcdef01234567',
        hasInstallScript: true,
      }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/from-git: .*does not come from the npm registry/)
  })

  it('ignores a non-registry package without an install script', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/from-git'] = {
        version: '1.0.0',
        resolved: 'git+ssh://git@github.com/example/from-git.git#0123456789abcdef0123456789abcdef01234567',
      }
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('reads a scope encoded as %2f in the resolved address', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/@anthropic-ai/claude-code'].resolved =
        'https://registry.npmjs.org/@anthropic-ai%2Fclaude-code/-/claude-code-2.1.311.tgz'
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('takes a package identity from the resolved address, not from its node_modules path', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/renamed'] = lock.packages['node_modules/bun']
      delete lock.packages['node_modules/bun']
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails when a value is not true or false', () => {
    const result = run(pkg => {
      pkg.allowScripts['bun@1.4.4'] = 'yes'
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"bun@1\.4\.4": the value must be true or false, not "yes"/)
  })

  it('treats a refused key like an approved one when comparing versions', () => {
    const result = run(pkg => {
      pkg.allowScripts['bun@1.4.4'] = false
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails on a lockfile without a packages field', () => {
    const result = run((pkg, lock) => {
      delete lock.packages
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /no "packages" field/)
  })
})
