import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const script = join(root, 'scripts/check-allow-scripts.mjs')

const basePackageJson = {
  name: 'fixture',
  devDependencies: { '@scope/tool': '2.0.0', native: '1.0.0', plain: '3.0.0' },
  allowScripts: { '@scope/tool@2.0.0': true, 'native@1.0.0': true },
}

const basePackageLock = {
  name: 'fixture',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'fixture', devDependencies: basePackageJson.devDependencies },
    'node_modules/@scope/tool': {
      version: '2.0.0',
      resolved: 'https://registry.npmjs.org/@scope/tool/-/tool-2.0.0.tgz',
      integrity: 'sha512-AAAA',
      dev: true,
      hasInstallScript: true,
    },
    'node_modules/native': {
      version: '1.0.0',
      resolved: 'https://registry.npmjs.org/native/-/native-1.0.0.tgz',
      integrity: 'sha512-BBBB',
      dev: true,
      hasInstallScript: true,
    },
    'node_modules/plain': {
      version: '3.0.0',
      resolved: 'https://registry.npmjs.org/plain/-/plain-3.0.0.tgz',
      integrity: 'sha512-CCCC',
      dev: true,
    },
  },
}

const scratch = mkdtempSync(join(tmpdir(), 'check-allow-scripts-'))
after(() => rmSync(scratch, { recursive: true, force: true }))

function run(change = () => {}) {
  const packageJson = structuredClone(basePackageJson)
  const lock = structuredClone(basePackageLock)
  change(packageJson, lock)
  const dir = mkdtempSync(join(scratch, 'case-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify(packageJson))
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(lock))
  const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

const renameKey = (allowScripts, from, to) => {
  const value = allowScripts[from]
  delete allowScripts[from]
  allowScripts[to] = value
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const nestedNative = lock => {
  lock.packages['node_modules/x'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz' }
  lock.packages['node_modules/x/node_modules/native'] = {
    ...lock.packages['node_modules/native'],
    version: '1.0.1',
    resolved: 'https://registry.npmjs.org/native/-/native-1.0.1.tgz',
  }
}

describe('check-allow-scripts', () => {
  it('passes for this repository as it is', () => {
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  })

  it('passes when every install script has an exact-version approval', () => {
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /@scope\/tool@2\.0\.0, native@1\.0\.0/)
  })

  it('fails and names the new key when Dependabot bumps an unscoped package', () => {
    const result = run(pkg => renameKey(pkg.allowScripts, 'native@1.0.0', 'native@0.9.0'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"native@0\.9\.0"/)
    assert.match(result.stderr, /locks native with an install script at 1\.0\.0/)
    assert.match(result.stderr, /change the key to "native@1\.0\.0"/)
  })

  it('fails and names the new key when a scoped package version differs', () => {
    const result = run(pkg => renameKey(pkg.allowScripts, '@scope/tool@2.0.0', '@scope/tool@1.9.0'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"@scope\/tool@1\.9\.0"/)
    assert.match(result.stderr, /change the key to "@scope\/tool@2\.0\.0"/)
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
      pkg.allowScripts['plain@3.0.0'] = true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"plain@3\.0\.0": package-lock\.json has no install script for plain@3\.0\.0\. Remove this key\./)
  })

  it('fails and tells how to add a missing approval', () => {
    const result = run(pkg => {
      delete pkg.allowScripts['native@1.0.0']
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /native@1\.0\.0 has an install script and no allowScripts entry/)
    assert.match(result.stderr, /add "native@1\.0\.0": true/)
  })

  it('fails when allowScripts is absent and the lockfile has install scripts', () => {
    const result = run(pkg => {
      delete pkg.allowScripts
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /add "native@1\.0\.0": true/)
    assert.match(result.stderr, /add "@scope\/tool@2\.0\.0": true/)
  })

  for (const key of ['native', 'native@^1.0.0', 'native@latest', 'native@v1.0.0']) {
    it(`fails on the non-exact key ${key}`, () => {
      const result = run(pkg => renameKey(pkg.allowScripts, 'native@1.0.0', key))
      assert.equal(result.status, 1)
      assert.match(result.stderr, new RegExp(`"${escapeRegExp(key)}": not an exact-version key`))
      assert.match(result.stderr, /Use "native@1\.0\.0"/)
    })
  }

  it('accepts one key listing every locked version joined with ||', () => {
    const result = run((pkg, lock) => {
      nestedNative(lock)
      renameKey(pkg.allowScripts, 'native@1.0.0', 'native@1.0.0 || 1.0.1')
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails and names both versions when one of two locked versions is approved', () => {
    const result = run((pkg, lock) => nestedNative(lock))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /locks native with an install script at 1\.0\.0, 1\.0\.1/)
    assert.match(result.stderr, /change the key to "native@1\.0\.0 \|\| 1\.0\.1"/)
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

  it('fails on the install script of a file: dependency outside node_modules', () => {
    const result = run((pkg, lock) => {
      lock.packages['../local-pkg'] = { version: '1.0.0', hasInstallScript: true }
      lock.packages['node_modules/local-pkg'] = { resolved: '../local-pkg', link: true }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /\.\.\/local-pkg: .*does not come from the npm registry/)
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
      lock.packages['node_modules/@scope/tool'].resolved = 'https://registry.npmjs.org/@scope%2Ftool/-/tool-2.0.0.tgz'
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('takes a package identity from the resolved address, not from its node_modules path', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/renamed'] = lock.packages['node_modules/native']
      delete lock.packages['node_modules/native']
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails when a value is not true or false', () => {
    const result = run(pkg => {
      pkg.allowScripts['native@1.0.0'] = 'yes'
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"native@1\.0\.0": the value must be true or false, not "yes"/)
  })

  it('treats a refused key like an approved one when comparing versions', () => {
    const result = run(pkg => {
      pkg.allowScripts['native@1.0.0'] = false
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
