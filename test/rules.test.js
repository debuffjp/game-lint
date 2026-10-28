import { describe, it } from "node:test";
import { RuleTester as EsRT } from "eslint";
import { RuleTester as OxRT } from "oxlint/plugins-dev";
import plugin from "../src/index.js";

const cases = {
  "no-unseeded-random": {
    valid: ["rng.next()", "function f(Math) { Math.random() }", "const crypto = lib; crypto.randomUUID()"],
    invalid: [
      { code: "const x = Math.random()", errors: [{ messageId: "random" }] },
      { code: "crypto.getRandomValues(buf)", errors: [{ messageId: "random" }] },
      { code: "window.Math.random()", errors: [{ messageId: "random" }] },
    ],
  },
  "no-wall-clock": {
    valid: ["new Date(0)", "clock.now()", "const performance = p; performance.now()"],
    invalid: [
      { code: "Date.now()", errors: [{ messageId: "clock" }] },
      { code: "performance.now()", errors: [{ messageId: "clock" }] },
      { code: "const d = new Date()", errors: [{ messageId: "clock" }] },
    ],
  },
  "no-real-timers": {
    valid: ["game.timers.after(1, f)", "function setTimeout() {} setTimeout()"],
    invalid: [
      { code: "setTimeout(f, 100)", errors: [{ messageId: "timer" }] },
      { code: "window.setInterval(f, 100)", errors: [{ messageId: "timer" }] },
    ],
  },
  "no-alloc-in-hot-path": {
    valid: [
      "function setup() { for (const e of es) e.v = { x: 1 } }",
      "class S { update(dt) { for (const e of this.es) e.x += dt } }",
      // Once per frame, or once per event: cheap.
      "class S { update() { if (jump) tweens.to(p, { y: 1 }) } }",
      "function render() { draw([a, b]) }",
      "class S { update() { for (const e of es) if (bad) throw new Error('x') } }",
      { code: "function step() { for (;;) f([]) }", options: [{ functions: ["update"] }] },
      "function update() { for (const c of coins) { if (c.taken) continue; emit({ c }) } }",
      "function update() { for (const e of es) if (e.hit) spark({ x: e.x }) }",
    ],
    invalid: [
      { code: "class S { update(dt) { for (const e of this.es) { const v = { x: e.x } } } }", errors: [{ messageId: "alloc" }] },
      { code: "function render() { es.forEach((e) => draw([e.x, e.y])) }", errors: [{ messageId: "alloc" }] },
      { code: "const update = () => { let i = 0; while (i++ < n) items.push(new Vec(i, 0)) }", errors: [{ messageId: "alloc" }] },
      { code: "function update() { for (const c of cs) { if (!overlaps(p, { x: c.x })) continue } }", errors: [{ messageId: "alloc" }] },
      { code: "obj.tick = function () { for (const e of es) e.hit = es.filter((o) => o.near) }", errors: [{ messageId: "alloc" }] },
    ],
  },
};

for (const [name, RT] of [
  ["oxlint", OxRT],
  ["eslint", EsRT],
]) {
  RT.describe = describe;
  RT.it = it;
  for (const [rule, c] of Object.entries(cases)) new RT().run(`${name}: ${rule}`, plugin.rules[rule], c);
}
