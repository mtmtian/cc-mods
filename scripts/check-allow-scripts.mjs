import { existsSync, readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'

const NUMBER = '(0|[1-9]\\d*)'
const PRERELEASE_ID = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][a-zA-Z0-9-]*)'
const SEMVER = new RegExp(
  `^v?${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*))?(?:\\+[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*)?$`,
)

const MAX_VERSION_LENGTH = 256

// What semver.parse(text).version gives, or null when semver.parse would refuse the text.
function normalizeVersion(text) {
  if (text.length > MAX_VERSION_LENGTH) return null
  const match = SEMVER.exec(text.trim())
  if (!match || match.slice(1, 4).some(part => Number(part) > Number.MAX_SAFE_INTEGER)) return null
  const [, major, minor, patch, prerelease] = match
  return `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}`
}

const isExactVersion = text => normalizeVersion(text) === text

// npm reads a registry package's identity from the lockfile's `resolved` address, never from
// its path in node_modules or from the tarball's own package.json, so this follows
// arborist/lib/version-from-tgz.js step for step, including what it refuses.
function registryIdentity(resolved) {
  if (typeof resolved !== 'string') return null
  const file = posix.basename(resolved)
  if (!file.endsWith('.tgz') || !/^https?:\//.test(resolved)) return null
  let pathname
  try {
    pathname = new URL(resolved).pathname
  } catch {
    return null
  }
  const segments = pathname.slice(1).split('/-/')
  if (segments.length < 2 || segments.pop() !== file) return null
  const parts = segments.pop().split(/\/|%2f/i)
  const project = parts.pop()
  const scope = parts.pop()
  if (!project || !file.startsWith(`${project}-`)) return null
  const version = normalizeVersion(file.slice(project.length + 1, -'.tgz'.length))
  if (!version) return null
  return { name: scope?.startsWith('@') ? `${scope}/${project}` : project, version }
}

const FILE_TYPE = /\.(?:tgz|tar\.gz|tar)$/i
const PACKAGE_NAME = /^(?:@[A-Za-z0-9~-][\w.~-]*\/)?[A-Za-z0-9~-][\w.~-]*$/
const PLAIN_REGISTRY_SPEC = /^[\w\s.^~<>=|*+!'()-]*$/

// A little stricter than npm-package-arg: a spec with @ : / \ # % ? in it is never taken for a registry spec.
const isPlainRegistrySpec = spec => PLAIN_REGISTRY_SPEC.test(spec) && !spec.startsWith('.') && !FILE_TYPE.test(spec)

const isRegistryName = name => PACKAGE_NAME.test(name) && !FILE_TYPE.test(name)

function isRegistrySpec(spec) {
  if (typeof spec !== 'string') return false
  if (!/^npm:/i.test(spec)) return isPlainRegistrySpec(spec)
  const target = spec.slice('npm:'.length)
  const at = target.indexOf('@', 1)
  return isRegistryName(at > 0 ? target.slice(0, at) : target) && isPlainRegistrySpec(at > 0 ? target.slice(at + 1) : '')
}

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const isTop = path => path === '' || !path.includes('node_modules/')

// npm keeps one edge per dependency name in a package: peer, then prod, then optional, then (top only) dev replace each other.
function declaredDependencies(manifest, top) {
  const fields = ['peerDependencies', 'dependencies', 'optionalDependencies', ...(top ? ['devDependencies'] : [])]
  return Object.assign({}, ...fields.map(field => (isObject(manifest[field]) ? manifest[field] : {})))
}

// Node resolves a dependency from the requiring package's own node_modules, then each enclosing one.
function findDependency(packages, from, name) {
  for (let dir = from; ; ) {
    const path = `${dir && `${dir}/`}node_modules/${name}`
    if (packages[path]) return path
    if (dir === '') return null
    const nested = dir.lastIndexOf('node_modules/')
    dir = nested <= 0 ? '' : dir.slice(0, nested - 1)
  }
}

// npm builds the root from package.json and every other package from its lockfile entry.
function incomingSpecs(packages, rootManifest) {
  const specs = new Map()
  const add = (path, spec) => specs.set(path, [...(specs.get(path) ?? []), spec])
  for (const [from, entry] of Object.entries(packages)) {
    const manifest = from === '' ? rootManifest : entry
    for (const [name, spec] of Object.entries(declaredDependencies(manifest, isTop(from)))) {
      const path = findDependency(packages, from, name)
      if (path === null) continue
      add(path, spec)
      if (packages[path].link) add(packages[path].resolved, spec)
    }
  }
  return specs
}

function addVersion(table, name, version) {
  if (!table.has(name)) table.set(name, new Set())
  table.get(name).add(version)
}

function readLockfile(lock, rootManifest) {
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json has no "packages" field. Regenerate it with lockfileVersion 2 or 3.')
  }
  const specs = incomingSpecs(lock.packages, rootManifest)
  const linkTargets = new Set(Object.values(lock.packages).filter(entry => entry.link).map(entry => entry.resolved))
  const expected = new Map()
  const locked = new Map()
  const problems = []
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '' || entry.inBundle || entry.link) continue
    const incoming = specs.get(path) ?? []
    if (incoming.length === 0 && linkTargets.has(path)) continue
    const foreign = incoming.find(spec => !isRegistrySpec(spec))
    if (incoming.length === 0 || foreign !== undefined) {
      const reason = incoming.length === 0 ? 'nothing in package.json or package-lock.json depends on it' : `it is a dependency on "${foreign}"`
      problems.push({
        name: path,
        line: `${path}: ${reason}, so npm does not approve it by name@version, and this check cannot see its install scripts (prepare included) before install. Extend this check before adding such a dependency.`,
      })
      continue
    }
    const identity = registryIdentity(entry.resolved)
    if (identity) {
      addVersion(locked, identity.name, identity.version)
      if (entry.hasInstallScript === true) addVersion(expected, identity.name, identity.version)
    } else if (entry.hasInstallScript === true) {
      problems.push({
        name: path,
        line: `${path}: npm cannot read a name and version from its resolved address (${entry.resolved ?? 'none'}), so no exact-version allowScripts key can approve its install script.`,
      })
    }
  }
  return { expected, locked, problems }
}

const sortedVersions = versions => [...versions].sort()
const approvalKey = (name, versions) => `${name}@${sortedVersions(versions).join(' || ')}`
const quoteAll = keys => keys.map(key => `"${key}"`).join(', ')

// npm splits a key into name and version at the first @ after the first character.
function groupKeys(allowScripts) {
  const groups = new Map()
  const problems = []
  for (const [key, value] of Object.entries(allowScripts)) {
    const at = key.indexOf('@', 1)
    const name = at > 0 ? key.slice(0, at) : key
    const versions = at > 0 ? key.slice(at + 1).split('||').map(version => version.trim()) : []
    const exact = at > 0 && versions.every(isExactVersion)
    if (!groups.has(name)) groups.set(name, { keys: [], exactKeys: [], looseKeys: [], versions: new Set() })
    const group = groups.get(name)
    group.keys.push(key)
    if (!exact) {
      group.looseKeys.push(key)
      continue
    }
    group.exactKeys.push(key)
    for (const version of versions) group.versions.add(version)
    if (typeof value !== 'boolean') {
      problems.push({ name, line: `"${key}": the value must be true or false, not ${JSON.stringify(value)}.` })
    }
  }
  return { groups, problems }
}

const sameVersions = (a, b) => a.size === b.size && [...a].every(version => b.has(version))
const listVersions = versions => sortedVersions(versions).join(', ')

function compare({ expected, locked, groups }) {
  const problems = []
  const report = (name, line) => problems.push({ name, line })
  for (const [name, { keys, exactKeys, looseKeys, versions }] of groups) {
    const those = keys.length > 1 ? 'these keys' : 'this key'
    const lockedVersions = locked.get(name)
    const expectedVersions = expected.get(name)
    if (!isRegistryName(name)) {
      report(name, `${quoteAll(keys)}: npm does not read "${name}" as a registry package name, so it ignores ${those}. Remove ${those}.`)
    } else if (!lockedVersions) {
      report(name, `${quoteAll(keys)}: ${name} is not a registry package in package-lock.json. Remove ${those}.`)
    } else if (!expectedVersions) {
      const lockedAt = sortedVersions(lockedVersions).map(version => `${name}@${version}`).join(', ')
      report(name, `${quoteAll(keys)}: package-lock.json has no install script for ${lockedAt}. Remove ${those}.`)
    } else if (keys.length === 1) {
      const wanted = approvalKey(name, expectedVersions)
      if (looseKeys.length === 1) {
        report(name, `"${keys[0]}": not an exact-version key. README approves install scripts by exact version. Use "${wanted}".`)
      } else if (!sameVersions(versions, expectedVersions)) {
        report(name, `"${keys[0]}": package-lock.json locks ${name} with an install script at ${listVersions(expectedVersions)}. After reviewing that version's install script, change the key to "${wanted}".`)
      }
    } else {
      for (const key of looseKeys) {
        report(name, `"${key}": not an exact-version key. README approves install scripts by exact version. Remove it, or rewrite it as an exact-version key for the version it covers. Locked with an install script: ${listVersions(expectedVersions)}.`)
      }
      const classes = [
        ['not in package-lock.json', [...versions].filter(version => !lockedVersions.has(version))],
        ['locked without an install script', [...versions].filter(version => lockedVersions.has(version) && !expectedVersions.has(version))],
        ['locked with an install script and no key', [...expectedVersions].filter(version => !versions.has(version))],
      ].filter(([, found]) => found.length > 0)
      if (classes.length > 0 && exactKeys.length > 0) {
        const listed = classes.map(([label, found]) => `Versions ${label}: ${listVersions(found)}.`).join(' ')
        report(name, `${quoteAll(exactKeys)}: package-lock.json locks ${name} with an install script at ${listVersions(expectedVersions)}. ${listed} After reviewing each version's install script, update these keys, keeping the true or false you decided for each version.`)
      }
    }
  }
  for (const [name, versions] of expected) {
    if (groups.has(name)) continue
    const wanted = approvalKey(name, versions)
    report(name, `${wanted} has an install script and no allowScripts entry. After reviewing it, add "${wanted}": true (npm install-scripts approve ${name}).`)
  }
  return problems
}

function unsupportedSetup(packageJson, hasShrinkwrap) {
  const isEmpty = value => value === undefined || (Array.isArray(value) ? value.length === 0 : isObject(value) && Object.keys(value).length === 0)
  const problems = []
  if (!isEmpty(packageJson.overrides)) {
    problems.push({ name: 'package.json overrides', line: 'package.json overrides: npm rewrites where dependencies come from with overrides, and this check does not apply them. Extend this check before adding overrides.' })
  }
  if (!isEmpty(packageJson.workspaces)) {
    problems.push({ name: 'package.json workspaces', line: 'package.json workspaces: this check does not follow workspace links. Extend this check before adding workspaces.' })
  }
  if (hasShrinkwrap) {
    problems.push({ name: 'npm-shrinkwrap.json', line: 'npm-shrinkwrap.json: npm reads it instead of package-lock.json, and this check does not. Remove it or extend this check.' })
  }
  return problems
}

function check(packageJson, lock, hasShrinkwrap) {
  const { expected, locked, problems: lockProblems } = readLockfile(lock, packageJson)
  const { groups, problems: policyProblems } = groupKeys(packageJson.allowScripts ?? {})
  const problems = [
    ...unsupportedSetup(packageJson, hasShrinkwrap),
    ...lockProblems,
    ...policyProblems,
    ...compare({ expected, locked, groups }),
  ]
  problems.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const approved = [...groups.values()].flatMap(({ keys }) => keys).sort()
  return { lines: problems.map(({ line }) => line), approved }
}

function main(argv) {
  const dir = resolve(argv[0] ?? process.cwd())
  let result
  try {
    const packageJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'))
    result = check(packageJson, lock, existsSync(join(dir, 'npm-shrinkwrap.json')))
  } catch (error) {
    console.error(`check-allow-scripts: ${error.message}`)
    return 2
  }
  if (result.lines.length > 0) {
    console.error('allowScripts in package.json does not match package-lock.json:')
    for (const line of result.lines) console.error(`  ${line}`)
    return 1
  }
  console.log(`allowScripts matches package-lock.json: ${result.approved.join(', ') || 'no install scripts to approve'}`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
