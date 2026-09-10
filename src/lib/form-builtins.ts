// Built-in request inputs (title / priority / needed-by / attachments / items+oracle).
// Stored on FormTemplates.RequestFormConfig as JSON so every form can decide
// which chrome inputs it wants — the fill page renders ONLY what's enabled
// here plus the custom fields the admin dragged into the form builder.
// Pure module — safe on both client and server.

export type BuiltinKey = 'title' | 'priority' | 'neededBy' | 'attachments' | 'items'

export interface BuiltinSetting {
  /** render the input on the fill page */
  show: boolean
  /** only where being empty can be an error (title / needed-by) */
  required: boolean
}

export interface RequestFormConfig {
  title: BuiltinSetting
  priority: BuiltinSetting
  neededBy: BuiltinSetting
  attachments: BuiltinSetting
  items: BuiltinSetting
}

export interface BuiltinDef {
  key: BuiltinKey
  label: string
  description: string
  icon: string
  /** whether the "required" checkbox makes sense for this input */
  hasRequired: boolean
}

export const BUILTIN_INPUTS: BuiltinDef[] = [
  { key: 'title', label: 'Request Title', description: 'Short summary shown in lists and notifications', icon: 'title', hasRequired: true },
  { key: 'priority', label: 'Priority', description: 'LOW / MEDIUM / HIGH / URGENT — drives SLA targets', icon: 'flag', hasRequired: false },
  { key: 'neededBy', label: 'Needed By Date', description: 'Requested delivery date', icon: 'event', hasRequired: true },
  { key: 'items', label: 'Items (catalog search)', description: 'Oracle catalog lookup + custom item rows', icon: 'inventory_2', hasRequired: false },
  { key: 'attachments', label: 'Attachments', description: 'File uploads offered at the bottom of the form', icon: 'attach_file', hasRequired: false },
]

/** Back-compat default: everything visible, title required (current behaviour). */
export function defaultRequestFormConfig(): RequestFormConfig {
  return {
    title: { show: true, required: true },
    priority: { show: true, required: false },
    neededBy: { show: true, required: false },
    items: { show: true, required: false },
    attachments: { show: true, required: false },
  }
}

function normOne(v: unknown, dflt: BuiltinSetting): BuiltinSetting {
  if (typeof v !== 'object' || v === null) return dflt
  const rec = v as Record<string, unknown>
  return {
    show: typeof rec.show === 'boolean' ? rec.show : dflt.show,
    required: typeof rec.required === 'boolean' ? rec.required : dflt.required,
  }
}

/** Parse the stored JSON (tolerates missing fields / old shapes). */
export function parseRequestFormConfig(raw: string | null | undefined): RequestFormConfig {
  const base = defaultRequestFormConfig()
  if (!raw) return base
  try {
    const o: unknown = JSON.parse(raw)
    if (typeof o !== 'object' || o === null) return base
    const rec = o as Record<string, unknown>
    const out = { ...base }
    for (const k of ['title', 'priority', 'neededBy', 'items', 'attachments'] as BuiltinKey[]) {
      out[k] = normOne(rec[k], base[k])
    }
    return out
  } catch {
    return base
  }
}
