/**
 * Postgres error helpers.
 *
 * Drizzle wraps driver errors: a unique-violation raised inside a
 * `db.transaction()` callback arrives as a `DrizzleQueryError` whose own
 * `code` is undefined, with the real Postgres error (carrying `code: "23505"`)
 * on `error.cause`. Checking `error.code` alone therefore silently fails to
 * recognise a duplicate, which turns an intended `409 Conflict` into a `500`.
 *
 * These helpers walk the cause chain (and the `errors` array some drivers use)
 * so callers can reliably branch on the underlying Postgres error code.
 */

/** Postgres SQLSTATE codes this project branches on. */
export const PG_UNIQUE_VIOLATION = "23505";
export const PG_FOREIGN_KEY_VIOLATION = "23503";
export const PG_NOT_NULL_VIOLATION = "23502";

function collect(value: unknown, seen: Set<unknown>): any[] {
  if (value === null || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  const node = value as any;
  const found: any[] = [node];
  if (node.cause !== undefined) found.push(...collect(node.cause, seen));
  if (Array.isArray(node.errors)) {
    for (const item of node.errors) found.push(...collect(item, seen));
  }
  return found;
}

/**
 * The Postgres/SQLSTATE code of an error, looking through Drizzle's wrapper
 * layers. Returns undefined when the error is not a database error.
 */
export function pgErrorCode(error: unknown): string | undefined {
  for (const node of collect(error, new Set())) {
    if (typeof node.code === "string") return node.code;
  }
  return undefined;
}

/** True when the error — at any depth — is a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === PG_UNIQUE_VIOLATION;
}

/** True when the error text mentions the given constraint name, at any depth. */
export function errorMentionsConstraint(
  error: unknown,
  constraintName: string,
): boolean {
  return collect(error, new Set()).some(
    (node) =>
      typeof node.constraint === "string" && node.constraint === constraintName,
  );
}

/**
 * Every human-readable message in the wrapper chain, outermost first. Useful
 * for matching text that a wrapper library buries on `cause`.
 */
export function errorMessageChain(error: unknown): string[] {
  return collect(error, new Set())
    .map((node) => (typeof node.message === "string" ? node.message : ""))
    .filter(Boolean);
}
