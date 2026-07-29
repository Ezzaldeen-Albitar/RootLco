# `validation.ts` — the prototype-reachable write

CodeQL alert **#28**, `js/remote-property-injection`, high precision,
`src/server/http/validation.ts:39`.

## The code

```ts
export function searchParamsToObject(params: URLSearchParams) {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    out[key] = values.length > 1 ? values : (values[0] ?? ''); // ← alert
  }
  return out;
}
```

`key` is a query-string name — attacker-chosen on every GET to the **24 list
routes** that call this. `out` is a plain `{}`.

## What is actually reachable

Measured with node, not reasoned about. Three defects, and the one CodeQL named
is the least of them.

### 1. Zod reads inherited properties

The important one, and invisible to the scanner.

```
Object.prototype.role = 'admin-via-prototype'
schema = z.object({ limit: z.string().optional(), role: z.string().optional() })

schema.safeParse(plainAccumulator)      → { limit: '25', role: 'admin-via-prototype' }
schema.safeParse(nullProtoAccumulator)  → { limit: '25' }
```

Against a plain `{}`, a polluted `Object.prototype` parses as a **validated**
field. `success: true`, and the route receives a value no client ever sent.
Several of the 24 routes validate authorization-shaped fields, so one prototype
write anywhere in the process would have injected them everywhere at once.

This is a property of the _accumulator's shape_, not of the flagged assignment.
CodeQL could not see it; running the code could.

### 2. The accumulator's own prototype was writable

```
out['__proto__'] = 'string'      → no change (the setter ignores a primitive)
out['__proto__'] = ['a','b']     → prototype of `out` IS now that array
```

Repeated parameters produce an array, and the setter accepts objects. So
`?__proto__=a&__proto__=b` reshaped the object.

**`Object.prototype` was never reachable this way.** Measured:
`({}).polluted === undefined` throughout. The honest scope is object-local, and
saying otherwise would overstate the finding.

### 3. A `__proto__` parameter was silently dropped

```
out['__proto__'] = 'sent-by-client'
Object.keys(out)  → []
```

The assignment hit the setter instead of creating a key, so the field never
reached Zod at all. No value, no error, nothing to debug.

## The fix, and the regression it first introduced

`Object.create(null)` **plus an explicit refusal of `__proto__`**.

The refusal is not belt-and-braces. A null prototype **alone** made the problem
_portable_, which an adversarial review caught:

|                                              | plain `{}`  | `Object.create(null)` alone |
| -------------------------------------------- | ----------- | --------------------------- |
| own names after `?__proto__=a&__proto__=b`   | `["limit"]` | `["__proto__","limit"]`     |
| `Object.assign({}, result)` target prototype | unchanged   | **becomes the array**       |
| `for…in` copy target prototype               | unchanged   | **becomes the array**       |
| spread `{...result}`                         | safe        | safe                        |
| survives a JSON round trip                   | n/a         | **yes**                     |

The old code produced an anomaly that died with the object. A null prototype
alone produced one that any downstream `[[Set]]`-semantics copy carries into a
fresh target. Nothing in `src/` does `Object.assign` or `for…in` over a query
object today — but "no caller does this today" is reasoning this repository has
already been wrong about.

So `__proto__` is refused outright: `ERR-VAL-001`, rule `forbidden_key`. No
schema can declare a field by that name, so nothing legitimate is turned away,
and refusing is not silent — silent dropping was defect 3.

`constructor` and `prototype` are deliberately **not** refused. They are
ordinary own keys with no setter behaviour, they shadow nothing on a
null-prototype object, and rejecting them would break generic form serialisers
for no benefit.

## Caller contract

All 24 callers pass the result directly to `parseOrFail`. Verified unchanged:
spread, `JSON.stringify`, `Object.entries`, `safeParse`, unknown-key stripping.

One behaviour does change: the result has no `Object.prototype` methods, so
`result.hasOwnProperty(…)` would throw. No caller does that — every use in
`src/` is the safe `Object.prototype.hasOwnProperty.call(…)` form — and a test
pins it.

## Evidence

`tests/foundation/validation.test.ts`, 12 tests:

- a polluted `Object.prototype` cannot inject a validated field
- the result inherits nothing at all
- `__proto__` is refused, single and repeated form
- **the result can never carry a `__proto__` key into an `Object.assign` or
  `for…in` copy** — the regression pin
- `Object.prototype` unchanged for every dangerous key
- `constructor`/`prototype` stored as inert data
- dotted, bracketed and percent-encoded spellings stored, not interpreted
- a generated sweep over dangerous key shapes
- Zod still parses normally, unknown fields still stripped
- one request cannot observe another's state
- spreadable, serialisable, enumerable for its callers

**Mutation**: restoring the plain `{}` accumulator fails **7 of the 12**.
