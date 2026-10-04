# cc-mods

Claude Code mods (function-hook plugins), forked from other authors or written here, kept in one repo. Each mod lives under `mods/<name>/`. A forked one is a squashed `git subtree` of its upstream: the upstream's license stays with it, and each squash commit names the upstream commit it came from. One written here has no upstream and carries its own license.

The repo is also a plugin marketplace, so a forked mod can be installed from here once it carries local changes.

## Mods

| Mod | Upstream | Local changes | License |
| --- | --- | --- | --- |
| [md-prompt](mods/md-prompt) | [nogu66/md-prompt](https://github.com/nogu66/md-prompt) | `0.2.0`: none. The dunder-path fix carried here as `0.1.1-cc.1` was taken upstream in 0.1.2 ([nogu66/md-prompt#4](https://github.com/nogu66/md-prompt/issues/4)), so the mod is upstream as is | MIT |
| [plan-progress](mods/plan-progress) | [zycck/claude-mods](https://github.com/zycck/claude-mods) | `0.7.1-cc.8`, on upstream 0.7.1: the usage rules ride in the tool description instead of `prompt.compose` (missing from the desktop engine when forked); no plan-mode import (ExitPlanMode → bar `plan`); no hidden demo-reel entry (it wrote a file to a model-given path); agent strip text and tool word follow the light/dark theme; only a running bar twinkles, and only near its head, and agent strips hold still; agent strips fold into one summary row by default (waiting and failed agents keep theirs), opened and folded again by the ▾ N / ▴ after the bar's title; finished bars leave after a minute; colours from the desktop app's own tokens, and a theme-aware state glyph; no Progress button in the footer (`/progress` and each bar's ✕ hide the bars); a permission dialog put to you and left unanswered sounds decision, on the engine's `permission_prompt` notification (upstream makes no sound for it); running clocks (a strip's, the pill's hover time) are text drawn again on each wall-clock second instead of CSS reels that run by themselves (the hover tips still flash and go: the desktop rebuilds an interactive frame about once a second whatever the plugins do; its own hover card, tried in 0.7.1-cc.5, holds but hangs on the whole track, so it was taken back), and a strip's status morph and the track head's slide play once (the desktop shows the band's last drawing again on repaints that never reach the mod, another plugin's redraw each second or a tool's timer, and that restarts its pictures: a clock stepping a second back, 1m 23s, 1m 24s, 1m 23s, its old word flashing, a finished bar's time sliding in again from mid-track), and a draw holding such a slide or morph is followed by one more as soon as it has played, since a finished bar has no running clock to bring that draw (its slide to the end stayed the last drawing, and each footer second of cache-timer flashed its head back to the step before); agents the main thread starts in a turn before it opens the bar for that work move onto that bar as it opens (an agent from an earlier turn stays where it is), and the mod's own Agents bar draws its strips alone, with no track, pill or percent (upstream counted finished agents as its steps, 0% until the last one ended), and leaves when they fold; the test engine shims `Uint8Array#toBase64` for Node before 25 | MIT |
| [cache-timer](mods/cache-timer) | none, written here (idea from [@savvyntsev](https://x.com/savvyntsev/status/2105982856455458905)) | `0.3.1`: counts down, as a dim label in the footer left of the model, how long the main thread's prompt cache stays warm; the lifetime starts at 1h and follows the API (a model switch names it, a hit or miss after 5 to 60 idle minutes tells 1h from 5m) | MIT |

## Install a mod from this repo

Function hooks are early access, so turn them on first in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

```bash
claude plugin marketplace add mtmtian/cc-mods
claude plugin install md-prompt@cc-mods
```

To install from a local checkout instead, so your own edits are what gets installed, pass its path: `claude plugin marketplace add <path to this checkout>`.

Install a mod from one marketplace only. With both `md-prompt@nogu66` and `md-prompt@cc-mods` enabled, the prompt box is painted twice.

## Change a mod

A local change bumps the mod's `version` in its `.claude-plugin/plugin.json` with a `-cc.N` suffix (`0.1.1-cc.1`, `0.1.1-cc.2`, ...), since installed copies only update when the version changes. Then:

```bash
claude plugin marketplace update cc-mods
claude plugin update md-prompt@cc-mods
```

While working on a mod, `--plugin-dir` loads the checkout directly and reloads on save (for md-prompt: `claude --plugin-dir mods/md-prompt/plugins/md-prompt`); each mod's own README has its test commands.

## Run the checks

Use the Node.js version in [`.node-version`](.node-version), then run from the repo root:

```bash
npm ci
npm run ci
```

The root [CI workflow](.github/workflows/ci.yml) runs on every pull request, pushes to `main`, and manual dispatch. Test and plugin checks run on standard Ubuntu and macOS runners; workflow and shell checks run in a separate Ubuntu job:

| Check | What it covers |
| --- | --- |
| `npm test` | md-prompt's Bun tests, plan-progress's asserted stub-engine regressions, and the upstream-status script's local Git fixtures |
| `npm run check:plugins` | Marketplace/source/name/license consistency, strict Claude manifest validation, native hook tests for md-prompt and cache-timer, and TypeScript checks for all three plugins |
| Workflow and shell checks | actionlint for the active root workflow and ShellCheck for the repository's shell scripts |

The plugin checks copy the plugins into a temporary directory, use a fresh Claude config, and generate SDK declarations for the locked CLI version there. `/cost` is a local command: no login or model API key is needed. The API endpoint is set to a closed local port, so an accidental model request fails. The temporary copies are removed even when a check fails. These checks do not replace testing real prompt editing, desktop rendering or audio in Claude Desktop.

Development tools are version-pinned in `package.json` and `package-lock.json`; Actions use full commit SHAs. Dependabot proposes weekly npm-tool and Action updates; update actionlint's version and checksum together in the workflow. Claude and Bun require their native-binary install scripts, approved by exact version in `allowScripts`. When updating either package, review its install script, update the approval with `npm install-scripts approve <package>`, and rerun the checks. CI has read-only repository permissions, cancels superseded PR runs, and uses neither uploaded artifacts nor dependency caches.

## Check and pull upstream changes

[`upstreams.tsv`](upstreams.tsv) lists each mod's upstream URL and branch. `scripts/upstream-status.sh` reads it and, per mod, prints the upstream commit last synced, the upstream commits since, the paths changed here, and the paths changed on both sides (`overlap_path=`, where a pull may conflict). It only fetches; it never pulls or edits a mod. `scripts/test-upstream-status.sh` checks it against a throwaway upstream.

```bash
bash scripts/upstream-status.sh
```

To take the upstream changes, with the URL and branch from `upstreams.tsv` (on a branch, merged with a merge commit so the squash commit's `git-subtree-split` trailer stays on `main`):

```bash
git subtree pull --prefix=mods/<name> <url> <branch> --squash
```

Resolve conflicts by keeping each local change on top of upstream's version, never by taking one side whole. Then check that every local change still holds: the mod's tests (each local change has a regress case where it can), and a strict type check against the engine's types, which catches call sites the two sides changed differently.

## Add another mod

```bash
git subtree add --prefix=mods/<name> https://github.com/<owner>/<repo>.git <branch> --squash
```

Then add the mod to `upstreams.tsv`, a row to the table above, and an entry to `.claude-plugin/marketplace.json` whose `source` points at the directory holding that mod's `.claude-plugin/plugin.json`.

A mod written here goes in `mods/<name>/plugins/<name>/` with its own `LICENSE` beside it; it gets a row in the table and a marketplace entry, but no `upstreams.tsv` line.

## Notes

- GitHub only runs workflows from the repo root's `.github/workflows`, so the CI files inside `mods/*/.github/` never run here.
- Each forked mod here is a personal build on upstream: upstream is the base and the local changes are kept on top of it, listed in the table. A local change leaves only when upstream ships the same behaviour (upstream's code then replaces ours, as md-prompt's dunder fix did in 0.1.2) or when we drop it ourselves; an upstream declining it is no reason to drop it. A fix useful to everyone may also be offered upstream as an issue or a pull request.
