# cc-mods

Claude Code mods (function-hook plugins) forked from other authors, kept in one repo. Each mod lives under `mods/<name>/` as a squashed `git subtree` of its upstream: the upstream's license stays with it, and each squash commit names the upstream commit it came from.

The repo is also a plugin marketplace, so a forked mod can be installed from here once it carries local changes.

## Mods

| Mod | Upstream | Local changes | License |
| --- | --- | --- | --- |
| [md-prompt](mods/md-prompt) | [nogu66/md-prompt](https://github.com/nogu66/md-prompt) | `0.1.1-cc.1`: `__tests__/`, `__pycache__` and other dunder paths are not painted bold ([nogu66/md-prompt#4](https://github.com/nogu66/md-prompt/issues/4)) | MIT |
| [plan-progress](mods/plan-progress) | [zycck/claude-mods](https://github.com/zycck/claude-mods) | `0.5.0-cc.2`: the usage rules ride in the tool description instead of `prompt.compose`, which the desktop app's engine (2.1.284) does not have; plan-mode import removed; the hidden demo-reel entry that wrote a file to a model-given path removed; agent strip text follows the light/dark theme (it was near-white on the light theme, 1.1:1) and the tool word reads at 4.5:1 or better on both; only a running bar twinkles, and only near its head; agent strips fold into one summary row by default (waiting and failed agents keep theirs, ▾ opens the rest); finished bars leave after a minute | MIT |

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

## Check and pull upstream changes

[`upstreams.tsv`](upstreams.tsv) lists each mod's upstream URL and branch. `scripts/upstream-status.sh` reads it and, per mod, prints the upstream commit last synced, the upstream commits since, the paths changed here, and the paths changed on both sides (`overlap_path=`, where a pull may conflict). It only fetches; it never pulls or edits a mod. `scripts/test-upstream-status.sh` checks it against a throwaway upstream.

```bash
bash scripts/upstream-status.sh
```

To take the upstream changes, with the URL and branch from `upstreams.tsv`:

```bash
git subtree pull --prefix=mods/<name> <url> <branch> --squash
```

## Add another mod

```bash
git subtree add --prefix=mods/<name> https://github.com/<owner>/<repo>.git <branch> --squash
```

Then add the mod to `upstreams.tsv`, a row to the table above, and an entry to `.claude-plugin/marketplace.json` whose `source` points at the directory holding that mod's `.claude-plugin/plugin.json`.

## Notes

- GitHub only runs workflows from the repo root's `.github/workflows`, so the CI files inside `mods/*/.github/` never run here.
- Fixes meant for an upstream go there as an issue or a pull request first; a local change stays here only until the upstream takes it or declines it, and is listed in the table.
