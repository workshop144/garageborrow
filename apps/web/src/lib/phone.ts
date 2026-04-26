// Phone parsing/formatting wrappers around libphonenumber-js. Inputs come
// from a single text field; output to the API is always E.164. Default
// country is US — the only country we currently serve.

import { AsYouType, parsePhoneNumberFromString } from "libphonenumber-js/min";

export const DEFAULT_COUNTRY = "US" as const;

export interface ParsedPhone {
  e164: string;
  national: string;
  isValid: boolean;
}

export function parsePhone(input: string): ParsedPhone | null {
  const parsed = parsePhoneNumberFromString(input, DEFAULT_COUNTRY);
  if (!parsed) return null;
  return {
    e164: parsed.number,
    national: parsed.formatNational(),
    isValid: parsed.isValid(),
  };
}

// Live formatter for input fields — call on every keystroke. Preserves the
// user's intent for partial entries (e.g. "(317) 555-").
export function formatAsYouType(input: string): string {
  const f = new AsYouType(DEFAULT_COUNTRY);
  return f.input(input);
}

// Returns the E.164 form when the input is a valid US number, otherwise
// null. Use this at submit time.
export function toE164(input: string): string | null {
  const p = parsePhone(input);
  if (!p || !p.isValid) return null;
  return p.e164;
}
