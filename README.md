# cc-mods

Claude Code mods (function-hook plugins) forked from other authors, kept in one repo. Each mod lives under `mods/<name>/` as a squashed `git subtree` of its upstream: the upstream's license stays with it, and each squash commit names the upstream commit it came from.

The repo is also a plugin marketplace, so a forked mod can be installed from here once it carries local changes.

## Mods

| Mod | Upstream | Synced at | Local changes | License |
| --- | --- | --- | --- | --- |
| [md-prompt](mods/md-prompt) | [nogu66/md-prompt](https://github.com/nogu66/md-prompt) | `e1b52f3` (0.1.1) | none | MIT |

## Install a mod from this repo

Function hooks are early access, so turn them on first in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
```

```bash
claude plugin marketplace add mtmtian/cc-mods
claude plugin install md-prompt@cc-mods
```

Install a mod from one marketplace only. With both `md-prompt@nogu66` and `md-prompt@cc-mods` enabled, the prompt box is painted twice.

## Pull upstream changes

```bash
git subtree pull --prefix=mods/md-prompt https://github.com/nogu66/md-prompt.git main --squash
```

Then update the "Synced at" column above.

## Add another mod

```bash
git subtree add --prefix=mods/<name> https://github.com/<owner>/<repo>.git <branch> --squash
```

Then add a row to the table above and an entry to `.claude-plugin/marketplace.json` whose `source` points at the directory holding that mod's `.claude-plugin/plugin.json`.

## Notes

- GitHub only runs workflows from the repo root's `.github/workflows`, so the CI files inside `mods/*/.github/` never run here.
- Fixes meant for an upstream go there as an issue or a pull request first; a local change stays here only until the upstream takes it or declines it, and is listed in the table.
