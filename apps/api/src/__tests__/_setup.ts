// Test scaffolding: wires the API up against an in-memory DynamoDB so each
// test can seed records, hit Hono routes via fetch(), and assert on responses.
//
// We replace the DocumentClient singleton with a stub that backs Get/Put/
// Update/Delete/Query against a Map keyed by `${PK}#${SK}`. Indexes are
// re-derived from items' GSI*PK / GSI*SK attributes for queries through
// IndexName: "byUser".

import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
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
}

export function seedItem(it: Item): void {
  store.items.set(keyOf(it), it);
}

export function listAll(): Item[] {
  return Array.from(store.items.values());
}

function applyUpdate(item: Item, cmd: UpdateCommand): Item {
  const expr = cmd.input.UpdateExpression ?? "";
  const values = cmd.input.ExpressionAttributeValues ?? {};
  const names = cmd.input.ExpressionAttributeNames ?? {};
  const next = { ...item };
  // Only ADD <field> :delta is used by the api today.
  const addMatch = /ADD\s+(#?\w+)\s+(:\w+)/.exec(expr);
  if (addMatch && addMatch[1] && addMatch[2]) {
    const rawName = addMatch[1];
    const rawVal = addMatch[2];
    const field = names[rawName] ?? rawName;
    const delta = values[rawVal];
    if (typeof delta === "number") {
      const current = typeof next[field] === "number" ? (next[field] as number) : 0;
      next[field] = current + delta;
    }
  }
  return next;
}

function evalFilter(
  it: Item,
  filterExpr: string | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!filterExpr) return true;
  // Hand-evaluate the small set of filters used by the codebase. This is
  // intentionally limited — extending it should be cheaper than pulling in
  // dynamodb-local.
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
    store.items.set(keyOf(item), item);
    return Promise.resolve({});
  });

  mock.on(DeleteCommand).callsFake((input) => {
    const k = `${input.Key.PK}#${input.Key.SK}`;
    store.items.delete(k);
    return Promise.resolve({});
  });

  mock.on(UpdateCommand).callsFake((input) => {
    const k = `${input.Key.PK}#${input.Key.SK}`;
    const cur = store.items.get(k) ?? ({ PK: input.Key.PK, SK: input.Key.SK } as Item);
    const next = applyUpdate(cur, new UpdateCommand(input));
    store.items.set(k, next);
    return Promise.resolve({});
  });

  mock.on(QueryCommand).callsFake((input) => {
    const values = input.ExpressionAttributeValues ?? {};
    const indexName = input.IndexName;
    const items = Array.from(store.items.values()).filter((it) => {
      if (indexName === "byUser") {
        const pkVal = values[":pk"];
        if (typeof pkVal !== "string" || it["GSI1PK"] !== pkVal) return false;
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
    const filtered = items.filter((it) =>
      evalFilter(it, input.FilterExpression ?? undefined, values),
    );
    return Promise.resolve({ Items: filtered });
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
