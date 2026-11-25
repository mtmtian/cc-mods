import { readFileSync } from 'node:fs'
import { join, posix, resolve } from 'node:path'

const NUMBER = '(0|[1-9]\\d*)'
const PRERELEASE_ID = '(?:0|[1-9]\\d*|\\d*[a-zA-Z-][a-zA-Z0-9-]*)'
const SEMVER = new RegExp(
  `^v?${NUMBER}\\.${NUMBER}\\.${NUMBER}(?:-(${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*))?(?:\\+[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*)?$`,
)

// What semver.parse(text).version gives, or null when semver.parse would refuse the text.
function normalizeVersion(text) {
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

// What npm-package-arg calls a registry spec: a version, range or tag, or an npm: alias of one.
function isRegistrySpec(spec) {
  if (typeof spec !== 'string') return false
  if (!spec.startsWith('npm:')) return isPlainRegistrySpec(spec)
  const target = spec.slice('npm:'.length)
  const at = target.lastIndexOf('@')
  const name = at > 0 ? target.slice(0, at) : target
  return /^(@[^/@:]+\/)?[^/@:]+$/.test(name) && (at <= 0 || isPlainRegistrySpec(target.slice(at + 1)))
}

const isPlainRegistrySpec = spec =>
  !/[:/\\]/.test(spec) && !spec.startsWith('.') && !/\.(tgz|tar|tar\.gz)$/i.test(spec)

const DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies']

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

function incomingSpecs(packages) {
  const specs = new Map()
  const add = (path, spec) => specs.set(path, [...(specs.get(path) ?? []), spec])
  for (const [from, entry] of Object.entries(packages)) {
    const fields = from === '' ? [...DEPENDENCY_FIELDS, 'devDependencies'] : DEPENDENCY_FIELDS
    for (const field of fields) {
      for (const [name, spec] of Object.entries(entry[field] ?? {})) {
        const path = findDependency(packages, from, name)
        if (path === null) continue
        add(path, spec)
        if (packages[path].link) add(packages[path].resolved, spec)
      }
    }
  }
  return specs
}

function addVersion(table, name, version) {
  if (!table.has(name)) table.set(name, new Set())
  table.get(name).add(version)
}

function readLockfile(lock) {
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json has no "packages" field. Regenerate it with lockfileVersion 2 or 3.')
  }
  const specs = incomingSpecs(lock.packages)
  const expected = new Map()
  const locked = new Map()
  const problems = []
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '' || entry.inBundle || entry.link) continue
    const incoming = specs.get(path) ?? []
    const foreign = incoming.find(spec => !isRegistrySpec(spec))
    if (incoming.length === 0 || foreign !== undefined) {
      const reason = incoming.length === 0 ? 'nothing in package-lock.json depends on it' : `it is a dependency on "${foreign}"`
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
        line: `${path}: npm cannot read a name and version from its resolved address (${entry.resolved ?? 'none'}), so no allowScripts key can approve its install script.`,
      })
    }
  }
  return { expected, locked, problems }
}

function splitKey(key) {
  const at = key.lastIndexOf('@')
  return at > 0 ? { name: key.slice(0, at), range: key.slice(at + 1) } : { name: key, range: null }
}

const sortedVersions = versions => [...versions].sort()
const approvalKey = (name, versions) => `${name}@${sortedVersions(versions).join(' || ')}`
const quoteAll = keys => keys.map(key => `"${key}"`).join(', ')

function readPolicy(allowScripts, expected) {
  const actual = new Map()
  const malformedNames = new Set()
  const problems = []
  for (const [key, value] of Object.entries(allowScripts)) {
    const { name, range } = splitKey(key)
    const versions = range === null ? [] : range.split('||').map(version => version.trim())
    if (versions.length === 0 || !versions.every(isExactVersion)) {
      malformedNames.add(name)
      const hint = expected.has(name)
        ? `Use "${approvalKey(name, expected.get(name))}".`
        : `Approve by exact version, such as "${name}@1.2.3", or remove this key.`
      problems.push({ name, line: `"${key}": not an exact-version key. README approves install scripts by exact version. ${hint}` })
      continue
    }
    if (typeof value !== 'boolean') {
      problems.push({ name, line: `"${key}": the value must be true or false, not ${JSON.stringify(value)}.` })
    }
    if (!actual.has(name)) actual.set(name, { keys: [], versions: new Set() })
    const approval = actual.get(name)
    approval.keys.push(key)
    for (const version of versions) approval.versions.add(version)
  }
  return { actual, malformedNames, problems }
}

const sameVersions = (a, b) => a.size === b.size && [...a].every(version => b.has(version))

function compare({ expected, locked, actual, malformedNames }) {
  const problems = []
  for (const [name, { keys, versions }] of actual) {
    const those = keys.length > 1 ? 'these keys' : 'this key'
    if (!locked.has(name)) {
      problems.push({ name, line: `${quoteAll(keys)}: ${name} is not a registry package in package-lock.json. Remove ${those}.` })
    } else if (!expected.has(name)) {
      const lockedAt = sortedVersions(locked.get(name)).map(version => `${name}@${version}`).join(', ')
      problems.push({ name, line: `${quoteAll(keys)}: package-lock.json has no install script for ${lockedAt}. Remove ${those}.` })
    } else if (!sameVersions(versions, expected.get(name))) {
      const lockedAt = sortedVersions(expected.get(name)).join(', ')
      const stale = sortedVersions(versions).filter(version => !expected.get(name).has(version))
      const missing = sortedVersions(expected.get(name)).filter(version => !versions.has(version))
      const advice = keys.length > 1
        ? `Versions no longer locked: ${stale.join(', ') || 'none'}. Versions with no key: ${missing.join(', ') || 'none'}. After reviewing each version's install script, update these keys so every locked version has one, keeping the true or false you decided for each.`
        : `After reviewing that version's install script, change the key to "${approvalKey(name, expected.get(name))}".`
      problems.push({ name, line: `${quoteAll(keys)}: package-lock.json locks ${name} with an install script at ${lockedAt}. ${advice}` })
    }
  }
  for (const [name, versions] of expected) {
    if (actual.has(name) || malformedNames.has(name)) continue
    const wanted = approvalKey(name, versions)
    problems.push({
      name,
      line: `${wanted} has an install script and no allowScripts entry. After reviewing it, add "${wanted}": true (npm install-scripts approve ${name}).`,
    })
  }
  return problems
}

function check(packageJson, lock) {
  const { expected, locked, problems: lockProblems } = readLockfile(lock)
  const { actual, malformedNames, problems: policyProblems } = readPolicy(packageJson.allowScripts ?? {}, expected)
  const problems = [...lockProblems, ...policyProblems, ...compare({ expected, locked, actual, malformedNames })]
  problems.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  const approved = [...actual.values()].flatMap(({ keys }) => keys).sort()
  return { lines: problems.map(({ line }) => line), approved }
}

function main(argv) {
  const dir = resolve(argv[0] ?? process.cwd())
  let result
  try {
    const packageJson = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'))
    result = check(packageJson, lock)
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
