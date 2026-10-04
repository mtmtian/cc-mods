# cache-timer

A label in the prompt footer, left of the model name, that counts down how long the main thread's prompt cache stays warm: `Cache 59:49`, then `Cache cold` once it has lapsed. It is a dim `Text` the mod draws at the head of the footer's mode chip (`SessionMode`), on the same line as the model and effort, with no plugin-name prefix. It draws its own tree because the desktop draws that chip from the props it holds: a label added to `modes` reaches the terminal but never the desktop's screen. Send the next message before it reaches zero and that message reads the conversation from the cache; send it after and it pays to write the whole conversation into the cache again.

Idea from [@savvyntsev](https://x.com/savvyntsev/status/2105982856455458905), who showed one in the desktop app without publishing the code. This one is written here.

## What it counts

- The clock restarts each time the main thread sends a request that gets a response. Subagents keep caches of their own and are not counted; a request that failed before any response does not restart it.
- How long the cache lives is not something a plugin can read directly. With the default `ttl: auto` the mod starts at 1h, then follows the API:
  - after a model switch, the engine names the lifetime (`cache_ttl` on `PostModelSwitch`) and the mod takes it;
  - a request on the same model sent 5 to 60 minutes after the previous one tells them apart: a cache read means 1h, a miss that writes the cache again means 5m.
- A resumed session starts from the resumed transcript's last response.
- The label is drawn again 25 ms after each wall-clock second and counts whole wall-clock seconds, so it steps once a second however late its timer fires. That is the instant plan-progress draws its band again: each redraw makes the desktop show the pictures on screen afresh, restarting their animations, and landing together keeps plan-progress's once-a-second loops unbroken.

Set `ttl` to `1h` or `5m` in the plugin's config row to always count down from that.

It only shows the time. It never sends anything to keep the cache warm.

## Test

```bash
claude plugin validate mods/cache-timer/plugins/cache-timer
claude plugin test mods/cache-timer/plugins/cache-timer
```

The tests run the hooks on the engine with a mocked clock and draw the footer through `ui.render`: the countdown and `Cache cold`, the label drawn before the native chip and redrawn just after each wall-clock second, wherever the session started, subagent and failed requests, the 5m/1h inference, the `5m` option, and resume.
