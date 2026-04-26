import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dateOf(iso: string): string {
  return iso.slice(0, 10);
}
