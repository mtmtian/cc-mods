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
  const dir = mkdtempSync(join(scratch, 'case-'))
  change(packageJson, lock, dir)
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

const depend = (pkg, lock, from, name, spec) => {
  const field = from === '' ? 'devDependencies' : 'dependencies'
  lock.packages[from][field] = { ...lock.packages[from][field], [name]: spec }
  if (from === '') pkg[field] = { ...pkg[field], [name]: spec }
}

const gitSpec = 'github:example/from-git'
const gitResolved = 'git+ssh://git@github.com/example/from-git.git#0123456789abcdef0123456789abcdef01234567'

const nestedNative = (pkg, lock) => {
  lock.packages['node_modules/x'] = { version: '1.0.0', resolved: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz' }
  depend(pkg, lock, '', 'x', '^1.0.0')
  depend(pkg, lock, 'node_modules/x', 'native', '1.0.1')
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
      nestedNative(pkg, lock)
      renameKey(pkg.allowScripts, 'native@1.0.0', 'native@1.0.0 || 1.0.1')
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails and names both versions when one of two locked versions is approved', () => {
    const result = run((pkg, lock) => nestedNative(pkg, lock))
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
      depend(pkg, lock, '', 'x', '^1.0.0')
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
      depend(pkg, lock, '', 'from-git', gitSpec)
      lock.packages['node_modules/from-git'] = { version: '1.0.0', resolved: gitResolved, hasInstallScript: true }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/from-git: it is a dependency on "github:example\/from-git"/)
  })

  it('fails on a git dependency even when the lockfile shows no install script', () => {
    const result = run((pkg, lock) => {
      depend(pkg, lock, '', 'from-git', gitSpec)
      lock.packages['node_modules/from-git'] = { version: '1.0.0', resolved: gitResolved }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/from-git: it is a dependency on "github:example\/from-git".*prepare included/)
  })

  it('fails on a file: dependency even when the lockfile shows no install script', () => {
    const result = run((pkg, lock) => {
      depend(pkg, lock, '', 'local', 'file:../local')
      lock.packages['node_modules/local'] = { resolved: '../local', link: true }
      lock.packages['../local'] = { version: '1.0.0' }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /\.\.\/local: it is a dependency on "file:\.\.\/local"/)
  })

  it('fails on a registry-shaped tarball address written as a dependency', () => {
    const result = run((pkg, lock) => {
      depend(pkg, lock, '', 'native', 'https://registry.npmjs.org/native/-/native-1.0.0.tgz')
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
    assert.match(result.stderr, /node_modules\/orphan: nothing in package\.json or package-lock\.json depends on it/)
  })

  it('fails when a transitive dependency is a git dependency of its parent', () => {
    const result = run((pkg, lock) => {
      depend(pkg, lock, 'node_modules/@scope/tool', 'deep', gitSpec)
      lock.packages['node_modules/deep'] = { version: '1.2.3', resolved: gitResolved, hasInstallScript: true }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/deep: it is a dependency on "github:example\/from-git"/)
  })

  it('holds a nested copy to the spec of the package that requires it', () => {
    const result = run((pkg, lock) => {
      nestedNative(pkg, lock)
      depend(pkg, lock, 'node_modules/x', 'native', gitSpec)
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/x\/node_modules\/native: it is a dependency on "github:example\/from-git"/)
    assert.doesNotMatch(result.stderr, /^ {2}node_modules\/native:/m)
  })

  const deep = (pkg, lock) => {
    depend(pkg, lock, 'node_modules/@scope/tool', 'deep', '^1.0.0')
    lock.packages['node_modules/deep'] = {
      version: '1.2.3',
      resolved: 'https://registry.npmjs.org/deep/-/deep-1.2.3.tgz',
      hasInstallScript: true,
    }
  }

  it('asks for an approval of a transitive dependency with an install script', () => {
    const result = run((pkg, lock) => deep(pkg, lock))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /add "deep@1\.2\.3": true/)
  })

  it('passes when a transitive dependency with an install script is approved', () => {
    const result = run((pkg, lock) => {
      deep(pkg, lock)
      pkg.allowScripts['deep@1.2.3'] = true
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('approves an npm: alias by the package it resolves to', () => {
    const result = run((pkg, lock) => {
      depend(pkg, lock, '', 'tool-alias', 'npm:@scope/tool@2.0.0')
      lock.packages['node_modules/tool-alias'] = lock.packages['node_modules/@scope/tool']
      delete lock.packages['node_modules/@scope/tool']
      delete lock.packages[''].devDependencies['@scope/tool']
      delete pkg.devDependencies['@scope/tool']
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
      nestedNative(pkg, lock)
      pkg.allowScripts['native@1.0.0'] = false
      pkg.allowScripts['native@0.9.0'] = true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Versions not in package-lock\.json: 0\.9\.0\. Versions locked with an install script and no key: 1\.0\.1\./)
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
      delete pkg.devDependencies.native
      depend(pkg, lock, '', 'renamed', '1.0.0')
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

  const nativeTarball = 'https://registry.npmjs.org/native/-/native-1.0.0.tgz'

  it('fails when package.json has overrides', () => {
    const result = run(pkg => {
      pkg.overrides = { native: nativeTarball }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /package\.json overrides: .*does not apply them/)
  })

  it('ignores an empty overrides object', () => {
    const result = run(pkg => {
      pkg.overrides = {}
    })
    assert.equal(result.status, 0, result.stderr)
  })

  it('fails once for workspaces without calling their dependencies orphans', () => {
    const result = run((pkg, lock) => {
      pkg.workspaces = ['packages/*']
      delete pkg.devDependencies.native
      delete lock.packages[''].devDependencies.native
      lock.packages['node_modules/tool'] = { resolved: 'packages/tool', link: true }
      lock.packages['packages/tool'] = { version: '1.0.0', devDependencies: { native: '1.0.0' } }
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /package\.json workspaces: /)
    assert.equal(result.stderr.trim().split('\n').length, 2, result.stderr)
  })

  it('fails when npm-shrinkwrap.json exists', () => {
    const result = run((pkg, lock, dir) => writeFileSync(join(dir, 'npm-shrinkwrap.json'), '{}'))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /npm-shrinkwrap\.json: npm reads it instead of package-lock\.json/)
  })

  it('reads the root dependencies from package.json, not from the lockfile root entry', () => {
    const result = run(pkg => {
      pkg.devDependencies.native = nativeTarball
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /node_modules\/native: it is a dependency on "https:\/\/registry\.npmjs\.org\/native\/-\/native-1\.0\.0\.tgz"/)
  })

  for (const prefix of ['NPM:', 'NpM:']) {
    it(`reads an alias written with the prefix ${prefix}`, () => {
      const result = run((pkg, lock) => {
        depend(pkg, lock, '', 'tool-alias', `${prefix}@scope/tool@2.0.0`)
        lock.packages['node_modules/tool-alias'] = lock.packages['node_modules/@scope/tool']
        delete lock.packages['node_modules/@scope/tool']
        delete lock.packages[''].devDependencies['@scope/tool']
        delete pkg.devDependencies['@scope/tool']
      })
      assert.equal(result.status, 0, result.stderr)
    })
  }

  describe('one dependency name declared in several fields of one package', () => {
    const bothNative = (pkg, lock) => {
      nestedNative(pkg, lock)
      renameKey(pkg.allowScripts, 'native@1.0.0', 'native@1.0.0 || 1.0.1')
    }

    it('keeps the dependencies spec over a peer tarball spec', () => {
      const result = run((pkg, lock) => {
        bothNative(pkg, lock)
        lock.packages['node_modules/x'].peerDependencies = { native: nativeTarball }
      })
      assert.equal(result.status, 0, result.stderr)
    })

    it('keeps the optional spec over a dependencies tarball spec', () => {
      const result = run((pkg, lock) => {
        bothNative(pkg, lock)
        lock.packages['node_modules/x'].dependencies = { native: nativeTarball }
        lock.packages['node_modules/x'].optionalDependencies = { native: '1.0.1' }
      })
      assert.equal(result.status, 0, result.stderr)
    })

    it('keeps the root devDependencies spec over a dependencies tarball spec', () => {
      const result = run(pkg => {
        pkg.dependencies = { native: nativeTarball }
      })
      assert.equal(result.status, 0, result.stderr)
    })

    it('keeps the root devDependencies tarball spec over a dependencies registry spec', () => {
      const result = run(pkg => {
        pkg.dependencies = { native: '1.0.0' }
        pkg.devDependencies.native = nativeTarball
      })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /node_modules\/native: it is a dependency on "https:/)
    })
  })

  describe('a package reached only through a peer dependency', () => {
    const peerOnly = pkg => {
      pkg.peerDependencies = { peered: '1.0.0' }
    }
    const peered = lock => {
      lock.packages['node_modules/peered'] = {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/peered/-/peered-1.0.0.tgz',
        hasInstallScript: true,
      }
    }

    it('needs a key for its install script', () => {
      const result = run((pkg, lock) => {
        peerOnly(pkg)
        peered(lock)
      })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /add "peered@1\.0\.0": true/)
    })

    it('passes once its install script is approved', () => {
      const result = run((pkg, lock) => {
        peerOnly(pkg)
        peered(lock)
        pkg.allowScripts['peered@1.0.0'] = true
      })
      assert.equal(result.status, 0, result.stderr)
    })
  })

  for (const [length, status] of [[256, 0], [257, 1]]) {
    it(`reads a resolved version ${length} characters long as semver does`, () => {
      const result = run((pkg, lock) => {
        const version = `2.0.0+${'a'.repeat(length - '2.0.0+'.length)}`
        lock.packages['node_modules/@scope/tool'].resolved = `https://registry.npmjs.org/@scope/tool/-/tool-${version}.tgz`
      })
      assert.equal(result.status, status, result.stderr)
      if (status === 1) assert.match(result.stderr, /npm cannot read a name and version from its resolved address/)
    })
  }

  it('fails on a key whose name npm reads as a file', () => {
    const result = run((pkg, lock) => {
      depend(pkg, lock, '', 'native.tgz', '1.0.0')
      lock.packages['node_modules/native.tgz'] = {
        version: '1.0.0',
        resolved: 'https://registry.npmjs.org/native.tgz/-/native.tgz-1.0.0.tgz',
        hasInstallScript: true,
      }
      pkg.allowScripts['native.tgz@1.0.0'] = true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"native\.tgz@1\.0\.0": npm does not read "native\.tgz" as a registry package name/)
  })

  it('does not suggest one merged key when a non-exact key is mixed with an exact one', () => {
    const result = run((pkg, lock) => {
      nestedNative(pkg, lock)
      pkg.allowScripts['native@1.0.0'] = false
      pkg.allowScripts['native@v1.0.1 || 1.0.2'] = true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /"native@v1\.0\.1 \|\| 1\.0\.2": not an exact-version key/)
    assert.match(result.stderr, /Versions locked with an install script and no key: 1\.0\.1\./)
    assert.doesNotMatch(result.stderr, /Use "native@1\.0\.0 \|\| 1\.0\.1"/)
    assert.doesNotMatch(result.stderr, /change the key to/)
  })

  it('tells a version locked without an install script from one that is not locked', () => {
    const result = run((pkg, lock) => {
      nestedNative(pkg, lock)
      delete lock.packages['node_modules/x/node_modules/native'].hasInstallScript
      pkg.allowScripts['native@1.0.1'] = true
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Versions locked without an install script: 1\.0\.1\./)
    assert.doesNotMatch(result.stderr, /not in package-lock\.json/)
  })

  it('fails on a lockfile without a packages field', () => {
    const result = run((pkg, lock) => {
      delete lock.packages
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /no "packages" field/)
  })
})
