// Test scaffolding: wires the API up against an in-memory DynamoDB so each
// test can seed records, hit Hono routes via fetch(), and assert on responses.
//
// We replace the DocumentClient singleton with a stub that backs Get/Put/
// Update/Delete/Query against a Map keyed by `${PK}#${SK}`. Indexes are
// re-derived from items' GSI*PK / GSI*SK attributes for queries through
// IndexName: "byUser".

import {
  BatchWriteCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

import { setAuthVerifier } from "../middleware/auth.js";
import type { Verifier } from "../middleware/auth.js";

type Item = Record<string, unknown> & { PK: string; SK: string };

interface Store {
  items: Map<string, Item>;
}

const store: Store = { items: new Map() };

function keyOf(it: { PK: string; SK: string }): string {
  return `${it.PK}#${it.SK}`;
}

export function resetDdbStore(): void {
  store.items.clear();
  queryPageSize = Infinity;
  afterNextScan = undefined;
  beforeNextTransact = undefined;
}

export function seedItem(it: Item): void {
  store.items.set(keyOf(it), it);
}

export function deleteItem(pk: string, sk: string): void {
  store.items.delete(`${pk}#${sk}`);
}

export function listAll(): Item[] {
  return Array.from(store.items.values());
}

interface UpdateOutcome {
  next: Item;
  // Mirrors the subset of UPDATED_NEW that the production code consumes.
  attributes: Record<string, unknown>;
}

function resolvePath(raw: string, names: Record<string, string>): string[] {
  return raw.split(".").map((seg) => names[seg.trim()] ?? seg.trim());
}

function setPath(item: Record<string, unknown>, path: string[], value: unknown): void {
  let cur: Record<string, unknown> = item;
  for (const seg of path.slice(0, -1)) {
    const next = cur[seg];
    if (typeof next !== "object" || next === null) throw new Error(`mock: no map at ${seg}`);
    cur[seg] = { ...(next as Record<string, unknown>) };
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[path[path.length - 1] as string] = value;
}

function applyUpdate(item: Item, cmd: UpdateCommand): UpdateOutcome {
  const expr = cmd.input.UpdateExpression ?? "";
  const values = cmd.input.ExpressionAttributeValues ?? {};
  const names = cmd.input.ExpressionAttributeNames ?? {};
  const next = { ...item };
  const attributes: Record<string, unknown> = {};
  // Clauses: "SET a = :v, #b.#c = :w", "ADD n :d", "REMOVE x, y", in any order.
  const clauses = expr.split(/\b(?=SET\b|ADD\b|REMOVE\b)/);
  for (const clause of clauses) {
    const m = /^(SET|ADD|REMOVE)\s+([\s\S]*)$/.exec(clause.trim());
    if (!m || !m[1] || !m[2]) continue;
    for (const part of m[2]
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean)) {
      if (m[1] === "SET") {
        const [lhs, rhs] = part.split("=").map((x) => x.trim());
        if (!lhs || !rhs) continue;
        const path = resolvePath(lhs, names);
        setPath(next, path, values[rhs]);
        attributes[path[0] as string] = next[path[0] as string];
      } else if (m[1] === "ADD") {
        const [rawName, rawVal] = part.split(/\s+/);
        if (!rawName || !rawVal) continue;
        const field = names[rawName] ?? rawName;
        const delta = values[rawVal];
        if (typeof delta === "number") {
          const current = typeof next[field] === "number" ? (next[field] as number) : 0;
          next[field] = current + delta;
          attributes[field] = next[field];
        }
      } else {
        delete next[resolvePath(part, names)[0] as string];
      }
    }
  }
  return { next, attributes };
}

// DynamoDB's "=" compares maps and lists by value, not identity.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

// ConditionExpression subset: AND-joined attribute_exists / attribute_not_exists /
// "#name = :v" / "name = :v". A failed check throws like DynamoDB does.
function checkCondition(
  cur: Item | undefined,
  expr: string | undefined,
  values: Record<string, unknown>,
  names: Record<string, string>,
): void {
  if (!expr) return;
  for (const raw of expr.split(/\s+AND\s+/i)) {
    const p = raw.trim();
    let ok: boolean;
    const ex = /^attribute_(not_)?exists\((#?\w+)\)$/.exec(p);
    const eq = /^(#?\w+)\s*=\s*(:\w+)$/.exec(p);
    if (ex && ex[2]) {
      const has = cur !== undefined && cur[names[ex[2]] ?? ex[2]] !== undefined;
      ok = ex[1] ? !has : has;
    } else if (eq && eq[1] && eq[2]) {
      ok = cur !== undefined && deepEqual(cur[names[eq[1]] ?? eq[1]], values[eq[2]]);
    } else {
      throw new Error(`mock: unsupported condition ${p}`);
    }
    if (!ok) {
      const err = new Error("The conditional request failed");
      err.name = "ConditionalCheckFailedException";
      throw err;
    }
  }
}

// Page size for Query responses (DynamoDB returns at most 1 MB per page). Tests
// shrink it to prove that callers follow LastEvaluatedKey.
let queryPageSize = Infinity;
export function setQueryPageSize(n: number): void {
  queryPageSize = n;
}

// Runs once, right after the next Scan computes its result: lets a test make a
// concurrent write land between a reader's Scan and its follow-up write.
let afterNextScan: (() => void) | undefined;
export function onNextScan(fn: () => void): void {
  afterNextScan = fn;
}

// Runs once, right before the next TransactWrite checks its conditions: lets a
// test land a competing commit between a reader's check and its write.
let beforeNextTransact: (() => void) | undefined;
export function onNextTransact(fn: () => void): void {
  beforeNextTransact = fn;
}

function evalFilter(
  it: Item,
  filterExpr: string | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!filterExpr) return true;
  // Hand-evaluate the small set of filters used by the codebase. This is
  // intentionally limited — extending it should be cheaper than pulling in
  // dynamodb-local. We support AND-joined and OR-joined clauses but not
  // mixed precedence (good enough for our actual filter usage).
  if (/\sOR\s/i.test(filterExpr)) {
    const orParts = filterExpr.split(/\s+OR\s+/i);
    return orParts.some((p) => evalFilter(it, p, values));
  }
  const parts = filterExpr.split(/\s+AND\s+/i);
  for (const p of parts) {
    const trimmed = p.trim();
    const eq = /^(\w+)\s*=\s*(:\w+)$/.exec(trimmed);
    if (eq && eq[1] && eq[2]) {
      if (it[eq[1]] !== values[eq[2]]) return false;
      continue;
    }
    const lt = /^(\w+)\s*<\s*(:\w+)$/.exec(trimmed);
    if (lt && lt[1] && lt[2]) {
      const a = it[lt[1]];
      const b = values[lt[2]];
      if (typeof a !== "string" || typeof b !== "string") return false;
      if (!(a < b)) return false;
      continue;
    }
    const exists = /^attribute_exists\((\w+)\)$/.exec(trimmed);
    if (exists && exists[1]) {
      if (it[exists[1]] === undefined) return false;
      continue;
    }
    const beginsPk = /^begins_with\(PK,\s*(:\w+)\)$/.exec(trimmed);
    if (beginsPk && beginsPk[1]) {
      const v = values[beginsPk[1]];
      if (typeof v !== "string" || !it.PK.startsWith(v)) return false;
      continue;
    }
    const beginsSk = /^begins_with\(SK,\s*(:\w+)\)$/.exec(trimmed);
    if (beginsSk && beginsSk[1]) {
      const v = values[beginsSk[1]];
      if (typeof v !== "string" || !it.SK.startsWith(v)) return false;
      continue;
    }
    const statusEq = /^#status\s*=\s*(:\w+)$/.exec(trimmed);
    if (statusEq && statusEq[1]) {
      if (it["status"] !== values[statusEq[1]]) return false;
      continue;
    }
    // Unknown filter clause — fail closed.
    return false;
  }
  return true;
}

export function installDdbMock(): void {
  const mock = mockClient(DynamoDBDocumentClient);

  mock.on(GetCommand).callsFake((input) => {
    const k = `${input.Key.PK}#${input.Key.SK}`;
    const item = store.items.get(k);
    return Promise.resolve({ Item: item });
  });

  mock.on(PutCommand).callsFake((input) => {
    const item = input.Item as Item;
    checkCondition(
      store.items.get(keyOf(item)),
      input.ConditionExpression,
      input.ExpressionAttributeValues ?? {},
      input.ExpressionAttributeNames ?? {},
    );
    store.items.set(keyOf(item), item);
    return Promise.resolve({});
  });

  mock.on(DeleteCommand).callsFake((input) => {
    const k = `${input.Key.PK}#${input.Key.SK}`;
    checkCondition(
      store.items.get(k),
      input.ConditionExpression,
      input.ExpressionAttributeValues ?? {},
      input.ExpressionAttributeNames ?? {},
    );
    store.items.delete(k);
    return Promise.resolve({});
  });

  mock.on(UpdateCommand).callsFake((input) => {
    const k = `${input.Key.PK}#${input.Key.SK}`;
    checkCondition(
      store.items.get(k),
      input.ConditionExpression,
      input.ExpressionAttributeValues ?? {},
      input.ExpressionAttributeNames ?? {},
    );
    const cur = store.items.get(k) ?? ({ PK: input.Key.PK, SK: input.Key.SK } as Item);
    const outcome = applyUpdate(cur, new UpdateCommand(input));
    store.items.set(k, outcome.next);
    if (input.ReturnValues === "UPDATED_NEW") {
      return Promise.resolve({ Attributes: outcome.attributes });
    }
    return Promise.resolve({});
  });

  // All-or-nothing: every condition is checked before any write is applied.
  mock.on(TransactWriteCommand).callsFake((input) => {
    const hook = beforeNextTransact;
    beforeNextTransact = undefined;
    hook?.();
    const ops = input.TransactItems ?? [];
    try {
      for (const op of ops) {
        const c = op.Delete ?? op.Put ?? op.Update ?? op.ConditionCheck;
        if (!c) continue;
        const key = op.Put ? keyOf(op.Put.Item as Item) : `${c.Key?.["PK"]}#${c.Key?.["SK"]}`;
        checkCondition(
          store.items.get(key),
          c.ConditionExpression,
          c.ExpressionAttributeValues ?? {},
          c.ExpressionAttributeNames ?? {},
        );
      }
    } catch {
      const err = new Error("Transaction cancelled");
      err.name = "TransactionCanceledException";
      throw err;
    }
    for (const op of ops) {
      if (op.Delete) store.items.delete(`${op.Delete.Key?.["PK"]}#${op.Delete.Key?.["SK"]}`);
      if (op.Put) store.items.set(keyOf(op.Put.Item as Item), op.Put.Item as Item);
      if (op.Update) throw new Error("mock: TransactWrite Update not supported");
    }
    return Promise.resolve({});
  });

  mock.on(ScanCommand).callsFake((input) => {
    const values = input.ExpressionAttributeValues ?? {};
    const all = Array.from(store.items.values());
    const filtered = all.filter((it) =>
      evalFilter(it, input.FilterExpression ?? undefined, values),
    );
    const hook = afterNextScan;
    afterNextScan = undefined;
    hook?.();
    return Promise.resolve({ Items: filtered });
  });

  mock.on(BatchWriteCommand).callsFake((input) => {
    const tables = (input.RequestItems ?? {}) as Record<
      string,
      Array<{
        DeleteRequest?: { Key: { PK: string; SK: string } };
        PutRequest?: { Item: Item };
      }>
    >;
    for (const reqs of Object.values(tables)) {
      for (const r of reqs) {
        if (r.DeleteRequest) {
          const k = `${r.DeleteRequest.Key.PK}#${r.DeleteRequest.Key.SK}`;
          store.items.delete(k);
        } else if (r.PutRequest) {
          const item = r.PutRequest.Item;
          store.items.set(keyOf(item), item);
        }
      }
    }
    return Promise.resolve({});
  });

  mock.on(QueryCommand).callsFake((input) => {
    const values = input.ExpressionAttributeValues ?? {};
    const indexName = input.IndexName;
    const items = Array.from(store.items.values()).filter((it) => {
      if (indexName === "byUser") {
        const pkVal = values[":pk"];
        if (typeof pkVal !== "string" || it["GSI1PK"] !== pkVal) return false;
        // "GSI1PK = :pk AND begins_with(GSI1SK, :sk)"
        const skVal = values[":sk"];
        if (typeof skVal === "string") {
          const gsk = it["GSI1SK"];
          if (typeof gsk !== "string" || !gsk.startsWith(skVal)) return false;
        }
        return true;
      }
      // Primary table: KeyConditionExpression "PK = :pk AND begins_with(SK, :sk)"
      // or "PK = :pk".
      const pkVal = values[":pk"];
      const skVal = values[":sk"];
      if (typeof pkVal !== "string" || it.PK !== pkVal) return false;
      if (typeof skVal === "string") {
        if (!it.SK.startsWith(skVal)) return false;
      }
      return true;
    });
    // Paginate before filtering, as DynamoDB does.
    const startKey = input.ExclusiveStartKey as { PK: string; SK: string } | undefined;
    const from = startKey ? items.findIndex((it) => keyOf(it) === keyOf(startKey)) + 1 : 0;
    const pageItems = items.slice(from, from + queryPageSize);
    const last = pageItems[pageItems.length - 1];
    const more = from + pageItems.length < items.length && last !== undefined;
    const filtered = pageItems.filter((it) =>
      evalFilter(it, input.FilterExpression ?? undefined, values),
    );
    return Promise.resolve({
      Items: filtered,
      ...(more ? { LastEvaluatedKey: { PK: last.PK, SK: last.SK } } : {}),
    });
  });
}

export function installFakeAuth(phone = "+15555550100"): void {
  const verifier: Verifier = (token: string) => {
    if (!token || token === "expired") {
      return Promise.reject(new Error("invalid"));
    }
    if (token.startsWith("phone:")) {
      const p = token.slice("phone:".length);
      return Promise.resolve({ phone: p, sub: `sub-${p}` });
    }
    return Promise.resolve({ phone, sub: `sub-${phone}` });
  };
  setAuthVerifier(verifier);
}

export function clearAuth(): void {
  setAuthVerifier(undefined);
}

export function authHeader(phone: string): { Authorization: string } {
  return { Authorization: `Bearer phone:${phone}` };
}
