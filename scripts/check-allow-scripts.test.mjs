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
  packageJson.devDependencies = lock.packages?.['']?.devDependencies
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

const depend = (lock, from, name, spec) => {
  const field = from === '' ? 'devDependencies' : 'dependencies'
  lock.packages[from][field] = { ...lock.packages[from][field], [name]: spec }
}

const gitSpec = 'github:example/from-git'
const gitResolved = 'git+ssh://git@github.com/example/from-git.git#0123456789abcdef0123456789abcdef01234567'

const nestedNative = lock => {
  lock.packages['node_modules/x'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz' }
  depend(lock, '', 'x', '^1.0.0')
  depend(lock, 'node_modules/x', 'native', '1.0.1')
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
    assert.match(result.stderr, /"left-pad@1\.3\.0": left-pad is not a registry package in package-lock\.json\. Remove this key\./)
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
      lock.packages['node_modules/x'] = {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz',
        dependencies: { bundled: '1.0.0' },
        bundleDependencies: ['bundled'],
      }
      depend(lock, '', 'x', '^1.0.0')
      lock.packages['node_modules/x/node_modules/bundled'] = {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/bundled/-/bundled-1.0.0.tgz',
        hasInstallScript: true,
        inBundle: true,
      }
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails on an install script in a git dependency', () => {
    const result = run((pkg, lock) => {
      depend(lock, '', 'from-git', gitSpec)
      lock.packages['node_modules/from-git'] = { version: '1.0.0', resolved: gitResolved, hasInstallScript: true }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/from-git: it is a dependency on "github:example\/from-git"/)
  })

  it('fails on a git dependency even when the lockfile shows no install script', () => {
    const result = run((pkg, lock) => {
      depend(lock, '', 'from-git', gitSpec)
      lock.packages['node_modules/from-git'] = { version: '1.0.0', resolved: gitResolved }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/from-git: it is a dependency on "github:example\/from-git".*prepare included/)
  })

  it('fails on a file: dependency even when the lockfile shows no install script', () => {
    const result = run((pkg, lock) => {
      depend(lock, '', 'local', 'file:../local')
      lock.packages['node_modules/local'] = { resolved: '../local', link: true }
      lock.packages['../local'] = { version: '1.0.0' }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /\.\.\/local: it is a dependency on "file:\.\.\/local"/)
  })

  it('fails on a registry-shaped tarball address written as a dependency', () => {
    const result = run((pkg, lock) => {
      depend(lock, '', 'native', 'https://registry.npmjs.org/native/-/native-1.0.0.tgz')
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/native: it is a dependency on "https:\/\/registry\.npmjs\.org\/native\/-\/native-1\.0\.0\.tgz"/)
  })

  it('fails on a package that nothing in the lockfile depends on', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/orphan'] = {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/orphan/-/orphan-1.0.0.tgz',
        hasInstallScript: true,
      }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/orphan: nothing in package-lock\.json depends on it/)
  })

  it('fails when a transitive dependency is a git dependency of its parent', () => {
    const result = run((pkg, lock) => {
      depend(lock, 'node_modules/@scope/tool', 'deep', gitSpec)
      lock.packages['node_modules/deep'] = { version: '1.2.3', resolved: gitResolved, hasInstallScript: true }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/deep: it is a dependency on "github:example\/from-git"/)
  })

  it('holds a nested copy to the spec of the package that requires it', () => {
    const result = run((pkg, lock) => {
      nestedNative(lock)
      depend(lock, 'node_modules/x', 'native', gitSpec)
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/x\/node_modules\/native: it is a dependency on "github:example\/from-git"/)
    assert.doesNotMatch(result.stderr, /^ {2}node_modules\/native:/m)
  })

  const deep = lock => {
    depend(lock, 'node_modules/@scope/tool', 'deep', '^1.0.0')
    lock.packages['node_modules/deep'] = {
      version: '1.2.3',
      resolved: 'https://registry.npmjs.org/deep/-/deep-1.2.3.tgz',
      hasInstallScript: true,
    }
  }

  it('asks for an approval of a transitive dependency with an install script', () => {
    const result = run((pkg, lock) => deep(lock))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /add "deep@1\.2\.3": true/)
  })

  it('passes when a transitive dependency with an install script is approved', () => {
    const result = run((pkg, lock) => {
      deep(lock)
      pkg.allowScripts['deep@1.2.3'] = true
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('approves an npm: alias by the package it resolves to', () => {
    const result = run((pkg, lock) => {
      depend(lock, '', 'tool-alias', 'npm:@scope/tool@2.0.0')
      lock.packages['node_modules/tool-alias'] = lock.packages['node_modules/@scope/tool']
      delete lock.packages['node_modules/@scope/tool']
      delete lock.packages[''].devDependencies['@scope/tool']
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails when npm cannot read a version from the resolved address of an install script', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/@scope/tool'].resolved = 'https://registry.npmjs.org/@scope/tool/-/tool-2.0.0.tgz?download=1'
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/@scope\/tool: npm cannot read a name and version from its resolved address/)
  })

  it('ignores a registry package with an unreadable address and no install script', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/plain'].resolved = 'https://registry.npmjs.org/plain/-/plain-3.0.0.tgz?download=1'
    })
    assert.equal(result.status, 0, result.stderr)
  })

  for (const file of ['tool-v2.0.0.tgz', 'tool-2.0.0+build.1.tgz']) {
    it(`reads the version npm reads from ${file}`, () => {
      const result = run((pkg, lock) => {
        lock.packages['node_modules/@scope/tool'].resolved = `https://registry.npmjs.org/@scope/tool/-/${file}`
      })
      assert.equal(result.status, 0, result.stderr)
    })
  }

  it('takes the version from the resolved address, not from the entry', () => {
    const result = run((pkg, lock) => {
      lock.packages['node_modules/@scope/tool'].version = '9.9.9'
    })
    assert.equal(result.status, 0, result.stderr)
  })

  for (const key of ['native@1.0.0-beta..1', 'native@01.0.0']) {
    it(`fails on the key ${key}, which npm does not read as a version`, () => {
      const result = run(pkg => renameKey(pkg.allowScripts, 'native@1.0.0', key))
      assert.equal(result.status, 1)
      assert.match(result.stderr, new RegExp(`"${escapeRegExp(key)}": not an exact-version key`))
    })
  }

  it('lists the versions to update when several keys for one package disagree with the lockfile', () => {
    const result = run((pkg, lock) => {
      nestedNative(lock)
      pkg.allowScripts['native@1.0.0'] = false
      pkg.allowScripts['native@0.9.0'] = true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Versions no longer locked: 0\.9\.0\. Versions with no key: 1\.0\.1\./)
    assert.doesNotMatch(result.stderr, /replace them with/)
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
      delete lock.packages[''].devDependencies.native
      depend(lock, '', 'renamed', '1.0.0')
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
