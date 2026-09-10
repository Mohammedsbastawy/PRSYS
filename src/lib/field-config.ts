// Shared field-type registry + Config protocol + value validation.
// Used by BOTH the client (builder, fill form, preview) and the server (API validation),
// so this module must stay dependency-free and side-effect-free.
//
// Stored value shape per type (RequestFieldValues.Value is always text):
//   text/textarea/email/tel/url/number/currency/date/time/datetime/select/radio/user/department
//     → raw string
//   checkbox        → "true" when checked, empty/absent when not
//   multiselect     → JSON array string, e.g. '["A","B"]'
//   file            → JSON array of attachment IDs, e.g. '["uuid1","uuid2"]'
//   section         → layout only, never stores a value
//
// Config protocol (FormFields.Config: JSON string or null):
//   { options[], help, placeholder, min, max, minLength, maxLength,
//     maxFiles, maxSizeMB, accept }
// Legacy shapes are still parsed on read (bare options array).

export interface FieldTypeDef {
  value: string;
  label: string;
  icon: string;
  group: string;
}

export const FIELD_TYPE_GROUPS = [
  "Basic Input",
  "Numbers & Dates",
  "Selection",
  "Organization",
  "Layout",
] as const;

export const FIELD_TYPES: FieldTypeDef[] = [
  // Basic Input
  { value: "text", label: "Text Input", icon: "text_fields", group: "Basic Input" },
  { value: "textarea", label: "Textarea", icon: "notes", group: "Basic Input" },
  { value: "email", label: "Email", icon: "mail", group: "Basic Input" },
  { value: "tel", label: "Phone", icon: "call", group: "Basic Input" },
  { value: "url", label: "URL / Link", icon: "link", group: "Basic Input" },
  { value: "file", label: "File Upload", icon: "attach_file", group: "Basic Input" },
  // Numbers & Dates
  { value: "number", label: "Number", icon: "numbers", group: "Numbers & Dates" },
  { value: "currency", label: "Currency", icon: "payments", group: "Numbers & Dates" },
  { value: "date", label: "Date Picker", icon: "calendar_month", group: "Numbers & Dates" },
  { value: "time", label: "Time Picker", icon: "schedule", group: "Numbers & Dates" },
  { value: "datetime", label: "Date & Time", icon: "event", group: "Numbers & Dates" },
  // Selection
  { value: "select", label: "Dropdown", icon: "arrow_drop_down_circle", group: "Selection" },
  { value: "radio", label: "Radio Group", icon: "radio_button_checked", group: "Selection" },
  { value: "multiselect", label: "Multi-Select", icon: "checklist", group: "Selection" },
  { value: "checkbox", label: "Checkbox", icon: "check_box", group: "Selection" },
  // Organization
  { value: "user", label: "User Picker", icon: "person", group: "Organization" },
  { value: "department", label: "Department Picker", icon: "apartment", group: "Organization" },
  // Layout
  { value: "section", label: "Section Header", icon: "title", group: "Layout" },
];

export const FIELD_TYPE_VALUES = [
  "text",
  "textarea",
  "email",
  "tel",
  "url",
  "file",
  "number",
  "currency",
  "date",
  "time",
  "datetime",
  "select",
  "radio",
  "multiselect",
  "checkbox",
  "user",
  "department",
  "section",
] as const;

export type FieldTypeValue = (typeof FIELD_TYPE_VALUES)[number];

export function fieldTypeLabel(v: string): string {
  return FIELD_TYPES.find((t) => t.value === v)?.label ?? v;
}

export function fieldTypeIcon(v: string): string {
  return FIELD_TYPES.find((t) => t.value === v)?.icon ?? "edit";
}

export function isKnownFieldType(v: string): boolean {
  return FIELD_TYPES.some((t) => t.value === v);
}

/* ---------------- Config read/write ---------------- */

export interface ParsedFieldConfig {
  options: string[];
  help: string;
  placeholder: string;
  min: string;
  max: string;
  minLength: string;
  maxLength: string;
  maxFiles: string;
  maxSizeMB: string;
  accept: string;
}

function cfgToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function acceptToString(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x: unknown) => String(x)).join(",");
  return "";
}

export function parseFieldConfig(cfg: string | null | undefined): ParsedFieldConfig {
  const empty: ParsedFieldConfig = {
    options: [],
    help: "",
    placeholder: "",
    min: "",
    max: "",
    minLength: "",
    maxLength: "",
    maxFiles: "",
    maxSizeMB: "",
    accept: "",
  };
  if (!cfg) return empty;
  try {
    const o: unknown = JSON.parse(cfg);
    if (Array.isArray(o)) {
      // legacy: bare options array
      return { ...empty, options: o.map((v: unknown) => String(v)) };
    }
    if (typeof o === "object" && o !== null) {
      const rec = o as Record<string, unknown>;
      let options: string[] = [];
      if (Array.isArray(rec.options)) {
        options = rec.options.map((x: unknown) =>
          typeof x === "object" && x !== null && "label" in x
            ? String((x as { label: unknown }).label)
            : String(x)
        );
      }
      return {
        options,
        help: typeof rec.help === "string" ? rec.help : "",
        placeholder: typeof rec.placeholder === "string" ? rec.placeholder : "",
        min: cfgToString(rec.min),
        max: cfgToString(rec.max),
        minLength: cfgToString(rec.minLength),
        maxLength: cfgToString(rec.maxLength),
        maxFiles: cfgToString(rec.maxFiles),
        maxSizeMB: cfgToString(rec.maxSizeMB),
        accept: acceptToString(rec.accept),
      };
    }
  } catch {
    /* invalid JSON — treat as empty */
  }
  return empty;
}

export function buildFieldConfig(o: {
  options?: string[];
  help?: string;
  placeholder?: string;
  min?: string | number;
  max?: string | number;
  minLength?: string | number;
  maxLength?: string | number;
  maxFiles?: string | number;
  maxSizeMB?: string | number;
  accept?: string;
}): string | null {
  const out: Record<string, unknown> = {};
  if (o.options && o.options.length > 0) out.options = o.options;
  if (o.help && o.help.trim()) out.help = o.help.trim();
  if (o.placeholder && o.placeholder.trim()) out.placeholder = o.placeholder.trim();
  const num = (v: string | number | undefined): number | null => {
    if (v === undefined) return null;
    const s = String(v).trim();
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };
  const min = num(o.min);
  const max = num(o.max);
  const minL = num(o.minLength);
  const maxL = num(o.maxLength);
  const maxF = num(o.maxFiles);
  const maxMB = num(o.maxSizeMB);
  if (min !== null) out.min = min;
  if (max !== null) out.max = max;
  if (minL !== null) out.minLength = minL;
  if (maxL !== null) out.maxLength = maxL;
  if (maxF !== null) out.maxFiles = maxF;
  if (maxMB !== null) out.maxSizeMB = maxMB;
  if (o.accept && o.accept.trim()) out.accept = o.accept.trim();
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}

/* ---------------- Value helpers ---------------- */

/** Parse a stored multiselect/file value (JSON array string) into an array. */
export function parseMultiValue(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const o: unknown = JSON.parse(raw);
    if (Array.isArray(o)) return o.map((v: unknown) => String(v));
  } catch {
    /* not JSON — fall through */
  }
  const t = raw.trim();
  return t ? [t] : [];
}

/** Parse an "accept" extensions string ("pdf, jpg") into clean lowercase extensions. */
export function parseAcceptList(accept: string | null | undefined): string[] {
  if (!accept) return [];
  return accept
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\.+/, ""))
    .filter((s) => /^[a-z0-9]{1,10}$/.test(s));
}

/** True when a stored value counts as "not filled" for a required check. */
export function isValueEmpty(type: string, raw: string | null | undefined): boolean {
  if (type === "section") return true;
  if (!raw) return true;
  const t = raw.trim();
  if (t === "") return true;
  if (type === "multiselect" || type === "file") return parseMultiValue(t).length === 0;
  return false;
}

/* ---------------- Format validation ---------------- */

function validDateYMD(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function validTimeHM(s: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) return false;
  return Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

function validDateTimeLocal(s: string): boolean {
  // datetime-local shape: YYYY-MM-DDTHH:MM[:SS]
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return false;
  const dt = new Date(s);
  return !Number.isNaN(dt.getTime());
}

/**
 * Validate the FORMAT of an entered value. Empty values always pass (the
 * required check is done separately via isValueEmpty). Returns an error
 * reason, or null when the value is acceptable.
 */
export function validateFieldValue(
  type: string,
  raw: string,
  cfg: ParsedFieldConfig
): string | null {
  if (isValueEmpty(type, raw)) return null;
  const v = raw.trim();

  switch (type) {
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "must be a valid email address";
    case "url": {
      if (!/^https?:\/\//i.test(v)) return "must start with http:// or https://";
      try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:"
          ? null
          : "must be a valid http(s) URL";
      } catch {
        return "must be a valid URL";
      }
    }
    case "tel": {
      if (!/^[+0-9().][0-9\s\-().]*$/.test(v)) return "must be a valid phone number";
      const digits = v.replace(/\D/g, "");
      return digits.length >= 7 ? null : "must be a valid phone number (7+ digits)";
    }
    case "number":
    case "currency": {
      const n = Number(v);
      if (!Number.isFinite(n)) return "must be a number";
      const min = cfg.min.trim() === "" ? null : Number(cfg.min);
      const max = cfg.max.trim() === "" ? null : Number(cfg.max);
      if (min !== null && Number.isFinite(min) && n < min) return `must be at least ${min}`;
      if (max !== null && Number.isFinite(max) && n > max) return `must be at most ${max}`;
      return null;
    }
    case "date":
      return validDateYMD(v) ? null : "must be a valid date (YYYY-MM-DD)";
    case "time":
      return validTimeHM(v) ? null : "must be a valid time (HH:MM)";
    case "datetime":
      return validDateTimeLocal(v) ? null : "must be a valid date and time";
    case "text":
    case "textarea": {
      const minL = cfg.minLength.trim() === "" ? null : Number(cfg.minLength);
      const maxL = cfg.maxLength.trim() === "" ? null : Number(cfg.maxLength);
      if (minL !== null && Number.isFinite(minL) && v.length < minL)
        return `must be at least ${minL} characters`;
      if (maxL !== null && Number.isFinite(maxL) && v.length > maxL)
        return `must be at most ${maxL} characters`;
      return null;
    }
    case "select":
    case "radio":
      if (cfg.options.length > 0 && !cfg.options.includes(v))
        return "must be one of the available options";
      return null;
    case "multiselect": {
      let arr: unknown;
      try {
        arr = JSON.parse(v);
      } catch {
        return "must be a valid multi-selection";
      }
      if (!Array.isArray(arr)) return "must be a valid multi-selection";
      if (cfg.options.length > 0) {
        const bad = arr.some((x) => !cfg.options.includes(String(x)));
        if (bad) return "must only contain available options";
      }
      return null;
    }
    case "file": {
      let arr: unknown;
      try {
        arr = JSON.parse(v);
      } catch {
        return "must be a valid file selection";
      }
      if (!Array.isArray(arr)) return "must be a valid file selection";
      return null;
    }
    case "checkbox":
      return v === "true" ? null : "has an invalid value";
    case "user":
    case "department":
    case "section":
    default:
      return null;
  }
}
