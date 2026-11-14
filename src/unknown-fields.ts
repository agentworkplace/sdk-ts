/**
 * Response fields added by a newer API must not break an installed SDK.
 * Contract schemas stay strict for requests and for the API's own responses;
 * here a response that fails only on unrecognized keys is parsed again with
 * those keys removed. Any other issue, such as an unknown enum value, still
 * fails, because a caller cannot safely act on a state it does not know.
 */

type PathSegment = string | number;

interface Removal {
  readonly path: readonly PathSegment[];
  readonly keys: readonly string[];
}

/** Each round removes every reported key; a few rounds cover re-chosen union branches. */
const maximumRounds = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPath = (value: unknown): value is PathSegment[] =>
  Array.isArray(value) &&
  value.every(
    (segment) => typeof segment === "string" || typeof segment === "number",
  );

const isKeys = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((key) => typeof key === "string");

/** Removals that would fix every issue, or undefined when any issue is another failure. */
function removalsFor(
  issues: readonly unknown[],
  prefix: readonly PathSegment[],
): Removal[] | undefined {
  const removals: Removal[] = [];
  for (const issue of issues) {
    if (!isRecord(issue) || !isPath(issue.path)) return undefined;
    const path = [...prefix, ...issue.path];
    if (issue.code === "unrecognized_keys" && isKeys(issue.keys)) {
      removals.push({ path, keys: issue.keys });
      continue;
    }
    // A failed plain union reports each branch with paths relative to the union.
    // Follow the first branch whose only failures are unrecognized keys, as Zod
    // itself accepts the first matching branch.
    if (issue.code === "invalid_union" && Array.isArray(issue.errors)) {
      const branch = issue.errors
        .map((branchIssues: unknown) =>
          Array.isArray(branchIssues)
            ? removalsFor(branchIssues, path)
            : undefined,
        )
        .find((candidate) => candidate !== undefined && candidate.length > 0);
      if (branch === undefined) return undefined;
      removals.push(...branch);
      continue;
    }
    return undefined;
  }
  return removals;
}

function validationIssues(error: unknown): readonly unknown[] | undefined {
  if (!(error instanceof Error) || error.name !== "ZodError") return undefined;
  const issues: unknown = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? issues : undefined;
}

/** Deletes the keys in place; returns whether anything was removed. */
function remove(value: unknown, removals: readonly Removal[]): boolean {
  let changed = false;
  for (const { path, keys } of removals) {
    let target: unknown = value;
    for (const segment of path) {
      if (!isRecord(target) || !Object.hasOwn(target, segment)) {
        target = undefined;
        break;
      }
      target = target[segment];
    }
    if (!isRecord(target) || Array.isArray(target)) continue;
    for (const key of keys) {
      if (!Object.hasOwn(target, key)) continue;
      // Keys come from parsed JSON, so a "__proto__" key is an own property.
      Reflect.deleteProperty(target, key);
      changed = true;
    }
  }
  return changed;
}

/**
 * Runs the parser, retrying without keys the schemas do not recognize. Throws
 * the parser's own error when the response has any other problem.
 */
export function parseIgnoringUnknownFields<T>(
  parse: (value: unknown) => T,
  body: unknown,
): T {
  let value = body;
  let copied = false;
  for (let round = 0; ; round += 1) {
    try {
      return parse(value);
    } catch (error) {
      const issues = validationIssues(error);
      const removals =
        issues === undefined || round === maximumRounds
          ? undefined
          : removalsFor(issues, []);
      if (removals === undefined || removals.length === 0) throw error;
      if (!copied) {
        value = structuredClone(value);
        copied = true;
      }
      if (!remove(value, removals)) throw error;
    }
  }
}
