# game-lint

Lint rules for game code. They catch the bugs that break replays, tests and frame pacing before you run anything: unseeded randomness, reading the real clock, browser timers in game logic, and allocating for every item, every frame. One plugin works in [oxlint](https://oxc.rs/docs/guide/usage/linter.html) and ESLint, with any engine.

```bash
npm install --save-dev game-lint
```

| Rule | Catches | Default |
| --- | --- | --- |
| [`game/no-unseeded-random`](#no-unseeded-random) | `Math.random()`, `crypto.getRandomValues()`, `crypto.randomUUID()` | error |
| [`game/no-wall-clock`](#no-wall-clock) | `Date.now()`, `performance.now()`, `new Date()` | error |
| [`game/no-real-timers`](#no-real-timers) | `setTimeout`, `setInterval`, `requestAnimationFrame`, `requestIdleCallback` | error |
| [`game/no-alloc-in-hot-path`](#no-alloc-in-hot-path) | object and array literals, `new` and closures inside loops in `update()`, `render()` and other per-frame functions | warn |

## Setup

Point the rules at your game logic, not at the whole project. Boot code, networking and menus may read the clock or use timers for good reasons; the simulation shouldn't.

### oxlint

oxlint's JS plugins are alpha, so pin the oxlint version.

```json
{
  "jsPlugins": ["game-lint"],
  "overrides": [
    {
      "files": ["src/sim/**", "src/scenes/**"],
      "rules": {
        "game/no-unseeded-random": "error",
        "game/no-wall-clock": "error",
        "game/no-real-timers": "error",
        "game/no-alloc-in-hot-path": "warn"
      }
    }
  ]
}
```

oxlint can't load a plugin's presets, so the rule list is written out. `game-lint/oxlintrc.json` has it to copy from.

### ESLint (flat config)

```js
// eslint.config.js
import game from "game-lint";

export default [{ files: ["src/sim/**", "src/scenes/**"], ...game.configs.recommended }];
```

## Rules

### no-unseeded-random

`Math.random()` gives different numbers on every run, so a replay or a test that plays the same inputs ends up somewhere else. Use your engine's seeded generator (or any small seeded PRNG) and keep the seed with the recording.

Local bindings named `Math` or `crypto` are left alone. `window.Math.random()` and `globalThis.crypto.randomUUID()` are caught.

### no-wall-clock

`Date.now()` and `performance.now()` change between runs and between machines. Game logic should move by the frame's delta, or by the game's own clock, so pausing, stepping and fast-forwarding work. `new Date(0)` and other dates built from a value are fine.

### no-real-timers

`setTimeout` and friends fire on real time, outside the game loop: a paused game keeps running them, and a replay played faster than real time sees them in the wrong frame. Use your engine's timers, or count frames.

### no-alloc-in-hot-path

An object or array made once per frame costs almost nothing. One made for every enemy, every frame, fills the garbage collector and turns into hitches. This rule reports allocations inside a loop (or a `forEach`, `map`, `filter` and similar callback) inside a per-frame function.

It skips code that only runs on some iterations, such as an `if` branch or the rest of a loop body after `if (...) continue;`, because that's usually an event like a pickup. Throwing errors is allowed.

Options:

```json
{ "game/no-alloc-in-hot-path": ["warn", { "functions": ["update", "render", "tick"], "allowNew": ["Vec2"] }] }
```

- `functions`: names of per-frame functions. Default: `update`, `fixedUpdate`, `render`, `draw`, `tick`, `step`.
- `allowNew`: constructors that are fine to call, on top of `Error`, `TypeError` and `RangeError`.

## What it doesn't catch

- Functions are found by name, so per-frame code under another name is missed until you add it to `functions`.
- Calls that allocate inside (`array.filter()`, string building) are not reported, only the literal, `new` or closure you can see.
- Rules don't follow calls: randomness inside a helper called from your game logic is only caught if the helper's file is linted too.

## Licence

MIT. Made by [debuff](https://debuff.jp). Come say hi on [Discord](https://discord.gg/jshbDHSpCY).
