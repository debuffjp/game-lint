// game-lint: lint rules for game code. One plugin for oxlint (jsPlugins) and ESLint (flat config).

/** True when `name` at `node` resolves to the global, not a local binding. Implicit globals have no defs. */
function isGlobal(context, node, name) {
  for (let s = context.sourceCode.getScope(node); s; s = s.upper) {
    const v = s.set.get(name);
    if (v && v.defs.length) return false;
  }
  return true;
}

/** `obj.prop` with a global `obj`, also reached through `window.` / `globalThis.`. */
function globalMember(context, node, obj, prop) {
  if (node.type !== "MemberExpression" || node.computed || node.property.name !== prop) return false;
  let o = node.object;
  if (o.type === "MemberExpression" && !o.computed && o.object.type === "Identifier" && ["window", "globalThis", "self"].includes(o.object.name)) {
    o = o.property;
    return o.name === obj;
  }
  return o.type === "Identifier" && o.name === obj && isGlobal(context, node, obj);
}

function globalCall(context, node, names) {
  const c = node.callee;
  if (c.type === "Identifier") return names.includes(c.name) && isGlobal(context, node, c.name) ? c.name : null;
  if (c.type === "MemberExpression" && !c.computed && c.object.type === "Identifier" && ["window", "globalThis", "self"].includes(c.object.name))
    return names.includes(c.property.name) ? c.property.name : null;
  return null;
}

const docs = (rule, description) => ({ description, url: `https://github.com/debuffjp/game-lint#${rule}` });

const noUnseededRandom = {
  meta: {
    type: "problem",
    docs: docs("no-unseeded-random", "Disallow unseeded randomness in game logic"),
    messages: { random: "{{what}} can't be replayed. Use the game's seeded random generator so tests and replays repeat exactly." },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        for (const [obj, prop] of [["Math", "random"], ["crypto", "getRandomValues"], ["crypto", "randomUUID"]])
          if (globalMember(context, node, obj, prop)) context.report({ node, messageId: "random", data: { what: `${obj}.${prop}` } });
      },
    };
  },
};

const noWallClock = {
  meta: {
    type: "problem",
    docs: docs("no-wall-clock", "Disallow reading the real clock in game logic"),
    messages: { clock: "{{what}} reads the real clock, so the game behaves differently on every run. Use the frame's delta or the game's clock." },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (globalMember(context, node, "Date", "now")) context.report({ node, messageId: "clock", data: { what: "Date.now" } });
        if (globalMember(context, node, "performance", "now")) context.report({ node, messageId: "clock", data: { what: "performance.now" } });
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Date" && node.arguments.length === 0 && isGlobal(context, node, "Date"))
          context.report({ node, messageId: "clock", data: { what: "new Date()" } });
      },
    };
  },
};

const TIMERS = ["setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback"];
const noRealTimers = {
  meta: {
    type: "problem",
    docs: docs("no-real-timers", "Disallow browser timers in game logic"),
    messages: { timer: "{{what}} runs on real time, outside the game loop, so pausing, stepping and replays miss it. Use the game's timers or count frames." },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        const name = globalCall(context, node, TIMERS);
        if (name) context.report({ node, messageId: "timer", data: { what: name } });
      },
    };
  },
};

const HOT = ["update", "fixedUpdate", "render", "draw", "tick", "step"];
const ALLOC = {
  ObjectExpression: "an object literal",
  ArrayExpression: "an array literal",
  NewExpression: "`new`",
  ArrowFunctionExpression: "a closure",
  FunctionExpression: "a closure",
};

function functionName(fn) {
  const p = fn.parent;
  if (fn.type === "FunctionDeclaration") return fn.id?.name;
  if (!p) return undefined;
  if ((p.type === "MethodDefinition" || p.type === "Property" || p.type === "PropertyDefinition") && !p.computed) return p.key.name ?? p.key.value;
  if (p.type === "VariableDeclarator" && p.id.type === "Identifier") return p.id.name;
  if (p.type === "AssignmentExpression" && p.left.type === "MemberExpression" && !p.left.computed) return p.left.property.name;
  return undefined;
}

const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const LOOP = new Set(["ForStatement", "ForOfStatement", "ForInStatement", "WhileStatement", "DoWhileStatement"]);
const ITERATE = new Set(["forEach", "map", "filter", "some", "every", "find", "findIndex", "reduce", "flatMap"]);

/** Whether `child`, directly under `parent`, only runs on some passes: an if/ternary/logical branch, a switch case, or a statement after an early exit. */
function isConditional(parent, child) {
  if ((parent.type === "IfStatement" || parent.type === "ConditionalExpression") && child !== parent.test) return true;
  if (parent.type === "LogicalExpression" && child === parent.right) return true;
  if (parent.type === "SwitchCase") return true;
  if (parent.type === "BlockStatement" && parent.body.includes(child)) {
    for (const st of parent.body) {
      if (st === child) break;
      if (st.type === "IfStatement" && exits(st.consequent)) return true;
    }
  }
  return false;
}

function exits(st) {
  if (["ContinueStatement", "ReturnStatement", "BreakStatement"].includes(st.type)) return true;
  return st.type === "BlockStatement" && st.body.length > 0 && exits(st.body.at(-1));
}

/** `list.forEach(fn)` and friends: the callback runs once per element. */
function isArrayCallback(fn) {
  const call = fn.parent;
  return call?.type === "CallExpression" && call.arguments.includes(fn) && call.callee.type === "MemberExpression" && !call.callee.computed && ITERATE.has(call.callee.property.name);
}

const noAllocInHotPath = {
  meta: {
    type: "suggestion",
    docs: docs("no-alloc-in-hot-path", "Disallow allocating in per-frame functions"),
    messages: { alloc: "{{what}} inside a loop in {{fn}}() allocates for every item, every frame, which feeds the garbage collector and causes hitches. Reuse an object made outside the loop." },
    schema: [
      {
        type: "object",
        properties: { functions: { type: "array", items: { type: "string" } }, allowNew: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const opts = context.options[0] ?? {};
    const hot = new Set(opts.functions ?? HOT);
    const allowNew = new Set(["Error", "TypeError", "RangeError", ...(opts.allowNew ?? [])]);
    /**
     * The hot function `node` allocates in, once per loop iteration: it must sit inside a loop (or an array
     * callback such as forEach) inside a function named in `functions`. One allocation per frame is cheap;
     * one per entity per frame is what fills the young generation and causes collection hitches.
     */
    const hotFn = (node) => {
      let looped = false;
      for (let n = node.parent, child = node; n; child = n, n = n.parent) {
        // Branches and code after an early `continue`/`return` run on some iterations, usually on an event
        // such as a pickup; only the always-run path of the loop body allocates every frame.
        if (!looped && isConditional(n, child)) return null;
        if (LOOP.has(n.type)) looped = true;
        if (FN.has(n.type)) {
          if (isArrayCallback(n)) {
            looped = true;
            continue;
          }
          const name = functionName(n);
          return looped && name && hot.has(name) ? name : null;
        }
      }
      return null;
    };
    const check = (node) => {
      if (node.type === "NewExpression" && node.callee.type === "Identifier" && allowNew.has(node.callee.name)) return;
      // `throw new Error()` and code after it only runs once, on the way out.
      if (node.parent?.type === "ThrowStatement") return;
      const fn = hotFn(node);
      if (fn) context.report({ node, messageId: "alloc", data: { what: ALLOC[node.type], fn } });
    };
    return Object.fromEntries(Object.keys(ALLOC).map((t) => [t, check]));
  },
};

const plugin = {
  meta: { name: "game" },
  rules: {
    "no-unseeded-random": noUnseededRandom,
    "no-wall-clock": noWallClock,
    "no-real-timers": noRealTimers,
    "no-alloc-in-hot-path": noAllocInHotPath,
  },
};
plugin.configs = {
  recommended: {
    plugins: { game: plugin },
    rules: { "game/no-unseeded-random": "error", "game/no-wall-clock": "error", "game/no-real-timers": "error", "game/no-alloc-in-hot-path": "warn" },
  },
};
export default plugin;
