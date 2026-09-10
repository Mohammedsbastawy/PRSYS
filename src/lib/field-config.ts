// Shared protocol for FormFields.Config (stored as a JSON string, or null).
//
// Supported shapes (all parsed, new writes always use the object form):
//   ["a", "b"]                          legacy select options
//   { options: ["a", "b"] }              select options
//   { help: "...", placeholder: "..." }  hints for any field type
//   { options: [...], help: "..." }      combined

export interface ParsedFieldConfig {
  options: string[];
  help: string;
  placeholder: string;
}

export function parseFieldConfig(cfg: string | null | undefined): ParsedFieldConfig {
  const empty: ParsedFieldConfig = { options: [], help: "", placeholder: "" };
  if (!cfg) return empty;
  try {
    const o: unknown = JSON.parse(cfg);
    if (Array.isArray(o)) {
      return { options: o.map((v: unknown) => String(v)), help: "", placeholder: "" };
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
}): string | null {
  const out: Record<string, unknown> = {};
  if (o.options && o.options.length > 0) out.options = o.options;
  if (o.help && o.help.trim()) out.help = o.help.trim();
  if (o.placeholder && o.placeholder.trim()) out.placeholder = o.placeholder.trim();
  return Object.keys(out).length > 0 ? JSON.stringify(out) : null;
}
