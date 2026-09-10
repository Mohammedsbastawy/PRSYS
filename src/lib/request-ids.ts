// Request ID (tracking number) format helpers — pure logic shared by the
// server (generation + validation) and the client (live previews).
//
// Format: {PREFIX}{SEP}[{YEAR}{SEP}]{SEQ}
//   prefix "PR", no separator, no padding → PR1, PR2, ...
//   prefix "PR", sep "-", padding 5      → PR-00001, PR-00002, ...
//   prefix "PR", sep "-", year on        → PR-2026-0001, ...
// Templates without a prefix keep the legacy global format: REQ-{YEAR}-{SEQ:5}

export interface RequestIdConfig {
  prefix: string | null;
  separator: string;
  padding: number;
  includeYear: boolean;
}

export const ID_PREFIX_RE = /^[A-Z0-9]{1,10}$/;
export const ID_SEPARATOR_RE = /^[-_./ ]{0,3}$/;

export function buildIdHead(cfg: RequestIdConfig, year: number): string | null {
  if (!cfg.prefix) return null;
  const sep = cfg.separator ?? "";
  return cfg.includeYear ? `${cfg.prefix}${sep}${year}${sep}` : `${cfg.prefix}${sep}`;
}

export function formatRequestId(cfg: RequestIdConfig, year: number, seq: number): string {
  const head = buildIdHead(cfg, year);
  const num = cfg.padding > 0 ? String(seq).padStart(cfg.padding, "0") : String(seq);
  if (!head) return `REQ-${year}-${String(seq).padStart(5, "0")}`;
  return `${head}${num}`;
}

/**
 * Validate ID-format settings. Expects an UPPERCASED prefix (or null).
 * Returns an error message, or null when valid.
 */
export function validateIdFormat(
  prefix: string | null,
  separator: string,
  padding: number,
  includeYear: boolean
): string | null {
  if (prefix !== null && !ID_PREFIX_RE.test(prefix)) {
    return "ID prefix must be 1-10 letters or digits";
  }
  if (!ID_SEPARATOR_RE.test(separator ?? "")) {
    return "ID separator may only contain - _ . / or space (max 3 characters)";
  }
  if (!Number.isInteger(padding) || padding < 0 || padding > 10) {
    return "ID padding must be a whole number between 0 and 10";
  }
  if (includeYear && (separator ?? "") === "") {
    return "Pick a separator to include the year in request IDs";
  }
  return null;
}
