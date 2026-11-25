import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?$/

function compareIdentifiers(a, b) {
  const aNumeric = /^\d+$/.test(a)
  const bNumeric = /^\d+$/.test(b)
  if (aNumeric && bNumeric) return Number(a) - Number(b)
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

function compareVersions(a, b) {
  const [aCore, aPre] = a.split(/-(.*)/s)
  const [bCore, bPre] = b.split(/-(.*)/s)
  const aParts = aCore.split('.')
  const bParts = bCore.split('.')
  for (let i = 0; i < 3; i++) {
    const diff = Number(aParts[i]) - Number(bParts[i])
    if (diff !== 0) return diff
  }
  if (aPre === undefined || bPre === undefined) return (aPre === undefined) - (bPre === undefined)
  const aIds = aPre.split('.')
  const bIds = bPre.split('.')
  for (let i = 0; i < Math.min(aIds.length, bIds.length); i++) {
    const diff = compareIdentifiers(aIds[i], bIds[i])
    if (diff !== 0) return diff
  }
  return aIds.length - bIds.length
}

// npm reads a registry package's identity from the lockfile's `resolved` address, never from
// its path in node_modules or from the tarball's own package.json, so this does the same
// (arborist/lib/version-from-tgz.js).
function registryIdentity(resolved) {
  if (typeof resolved !== 'string' || !/^https?:\/\//i.test(resolved)) return null
  let pathname
  try {
    pathname = new URL(resolved).pathname
  } catch {
    return null
  }
  const file = basename(pathname)
  if (!file.endsWith('.tgz')) return null
  const segments = pathname.slice(1).split('/-/')
  if (segments.length < 2 || segments.pop() !== file) return null
  const parts = segments.pop().split(/\/|%2f/i)
  const project = parts.pop()
  const scope = parts.pop()
  if (!project || !file.startsWith(`${project}-`)) return null
  const version = file.slice(project.length + 1, -'.tgz'.length)
  if (!EXACT_VERSION.test(version)) return null
  return { name: scope?.startsWith('@') ? `${scope}/${project}` : project, version }
}

function addVersion(table, name, version) {
  if (!table.has(name)) table.set(name, new Set())
  table.get(name).add(version)
}

function readLockfile(lock) {
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error('package-lock.json has no "packages" field. Regenerate it with lockfileVersion 2 or 3.')
  }
  const expected = new Map()
  const locked = new Map()
  const problems = []
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes('node_modules/') || entry.inBundle || entry.link) continue
    const identity = registryIdentity(entry.resolved)
    if (identity) {
      addVersion(locked, identity.name, identity.version)
      if (entry.hasInstallScript === true) addVersion(expected, identity.name, identity.version)
    } else if (entry.hasInstallScript === true) {
      problems.push({
        name: path,
        line: `${path}: package-lock.json has an install script for a package that does not come from the npm registry (resolved: ${entry.resolved ?? 'none'}). This check only covers registry packages. Approve it by hand and extend the check.`,
      })
    }
  }
  return { expected, locked, problems }
}

function splitKey(key) {
  const at = key.lastIndexOf('@')
  return at > 0 ? { name: key.slice(0, at), range: key.slice(at + 1) } : { name: key, range: null }
}

const sortedVersions = versions => [...versions].sort(compareVersions)
const approvalKey = (name, versions) => `${name}@${sortedVersions(versions).join(' || ')}`
const quoteAll = keys => keys.map(key => `"${key}"`).join(', ')

function readPolicy(allowScripts, expected) {
  const actual = new Map()
  const malformedNames = new Set()
  const problems = []
  for (const [key, value] of Object.entries(allowScripts)) {
    const { name, range } = splitKey(key)
    const versions = range === null ? [] : range.split('||').map(version => version.trim())
    if (versions.length === 0 || !versions.every(version => EXACT_VERSION.test(version))) {
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
      problems.push({ name, line: `${quoteAll(keys)}: ${name} is not in package-lock.json. Remove ${those}.` })
    } else if (!expected.has(name)) {
      const lockedAt = sortedVersions(locked.get(name)).map(version => `${name}@${version}`).join(', ')
      problems.push({ name, line: `${quoteAll(keys)}: package-lock.json has no install script for ${lockedAt}. Remove ${those}.` })
    } else if (!sameVersions(versions, expected.get(name))) {
      const wanted = approvalKey(name, expected.get(name))
      const lockedAt = sortedVersions(expected.get(name)).join(', ')
      const change = keys.length > 1 ? `replace them with "${wanted}"` : `change the key to "${wanted}"`
      problems.push({
        name,
        line: `${quoteAll(keys)}: package-lock.json locks ${name} with an install script at ${lockedAt}. After reviewing that version's install script, ${change}.`,
      })
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
