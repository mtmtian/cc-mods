// transpiles the real register.tsx into an ES module that imports a stub engine library
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { dirname, join, parse } = require('node:path')
const [src, out] = process.argv.slice(2)
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
const scratch = fs.mkdtempSync(join(tmpdir(), 'cc-mods-plan-progress-'))
try {
  // TypeScript 7 no longer exposes transpileModule. Keep this transpile-only;
  // check:plugins separately checks types against the generated engine SDK.
  execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noCheck',
    '--module', 'ESNext', '--target', 'ES2022', '--jsx', 'react', '--jsxFactory', 'h',
    '--outDir', scratch, src], { stdio: 'inherit' })
  const js = fs.readFileSync(join(scratch, `${parse(src).name}.js`), 'utf8')
    .replace(/from ['"]claude-code['"]/g, "from './stub.mjs'")
  fs.writeFileSync(out, js)
  console.log('compiled', out, js.length)
} finally {
  fs.rmSync(scratch, { recursive: true, force: true })
}
