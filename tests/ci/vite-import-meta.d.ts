/**
 * `import.meta.glob` for the root TypeScript project.
 *
 * The web workspace pulls in `vite/client`, which declares this. The ROOT
 * tsconfig does not, and it is the root that checks `tests/**` — so without this
 * declaration `npm run typecheck` fails on two test files that the unit tier runs
 * perfectly well.
 *
 * It has to be an ambient declaration rather than a local cast, because
 * `import.meta.glob` is a COMPILE-TIME transform: Vite rewrites the call site into
 * a static import map. Assigning it to a variable first — `const g =
 * import.meta.glob; g(...)` — type-checks and then fails at runtime with
 * "globModules is not a function", because there was never a function there to
 * assign. The call must stay written out in full, so the type has to come to it.
 *
 * Kept here, beside the two files that need it, rather than added to the root
 * tsconfig's `types` — a test directory should not be able to widen the ambient
 * types of the whole tree by editing a config it does not own.
 */
interface ImportMeta {
  /** Eagerly import every module matching a glob. Vite rewrites this call site. */
  glob(pattern: string, options: { readonly eager: true }): Record<string, Record<string, unknown>>;
}
