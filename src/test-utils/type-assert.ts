/**
 * Compile-time type assertions for protecting refactors.
 *
 * Usage (checked by `tsc --noEmit`, no runtime cost):
 *
 *   type _Snapshot = Expect<
 *     Equals<Awaited<ReturnType<typeof someAction>>, { data: Foo } | { error: string }>
 *   >
 *
 * If the function's type drifts from the snapshot, `Equals` resolves to
 * `false`, `Expect<false>` fails to compile, and the build breaks — before
 * or after a refactor.
 */

/** Resolves to `true` only when `A` and `B` are mutually assignable (invariant equal). */
export type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

/** Compiles only when `T` is exactly `true`. Use to force a type snapshot to hold. */
export type Expect<T extends true> = T
