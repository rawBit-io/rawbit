/* ------------------------------------------------------------------
 * utils.ts – small, side-effect-free helper primitives shared across
 *            the application.  The file is intentionally
 *            dependency-light so it can be imported anywhere without
 *            pulling large bundles.
 *
 *  Sections
 *  ──────────────────────────────────────────────────────────────────
 *   1.  CSS helpers                     (clsx + twMerge wrapper)
 *   2.  “vals” dictionary helpers       (get/set values at sparse index)
 *   3.  Node-index spacing constants    (FIELD_/INSTANCE_/GROUP_STRIDE)
 * ------------------------------------------------------------------*/

/* ================================================================ */
/* 1.  CSS helpers                                                   */
/* ================================================================ */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * `cn()` – Tailwind-aware replacement for `classNames`.  Accepts the same
 * inputs as `clsx` *and* merges duplicate Tailwind utility classes so the
 * *last* one wins (just like inline-style precedence).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* ================================================================ */
/* 2.  “vals” dictionary helpers                                     */
/* ================================================================ */

/* ------------------------------------------------------------------
 * Internals – type narrowing + normalisation
 * ------------------------------------------------------------------*/

/**
 * Runtime type-guard to detect the sparse-dictionary format
 * `{[index:number]: string}` introduced after 2024-10.
 */
export function isValsDict(v: unknown): v is Record<number, string> {
  return !!v && !Array.isArray(v) && typeof v === "object";
}

/**
 * Return the string at `idx` from either storage format.
 */
export function getVal(store: unknown, idx: number): string {
  if (!store) return "";
  if (isValsDict(store)) return store[idx] ?? "";
  return (store as string[])[idx] ?? "";
}

/**
 * Mutate-copy helper that writes `value` at `idx`, always returning the
 * sparse-dictionary format.  An empty string **deletes** the key so saved
 * JSON stays compact.
 */
export function setVal(
  store: unknown,
  idx: number,
  value: string
): Record<number, string> {
  // 1) normalise to Record<number,string> (a missing store starts empty)
  const dict: Record<number, string> = isValsDict(store)
    ? { ...store }
    : Array.isArray(store)
      ? Object.fromEntries(
          (store as string[]).map((v, i) => [i, v]).filter(([, v]) => v !== "")
        )
      : {};

  // 2) write / delete
  if (value === "") delete dict[idx];
  else dict[idx] = value;

  return dict;
}

/* ================================================================ */
/* 3.  Node-index spacing constants                                  */
/* ================================================================ */

/**
 * These numbers are baked into both template JSON *and* runtime UI logic.
 * Changing them will break backward-compat.  Keep in sync!
 */
export const FIELD_STRIDE = 10; // spacing between *fields* inside a group
export const INSTANCE_STRIDE = 100; // spacing between *instances* of a group
export const GROUP_STRIDE = 10000; // spacing between *different* groups
