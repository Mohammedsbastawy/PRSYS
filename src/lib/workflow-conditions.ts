// Step skip-conditions for workflows ("this step applies when ...").
//
// Stored on WFSteps.Condition as a JSON string like:
//   {"field":"totalValue","op":">=","value":"50000"}
//   {"field":"priority","op":"in","value":"HIGH,URGENT"}
// A null/empty/unparseable condition means the step always applies.
//
// Pure helpers — no prisma, safe to import from API routes and client components.

export type ConditionField = 'totalValue' | 'itemCount' | 'priority'
export type ConditionOp = '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in'

export interface StepCondition {
  field: ConditionField
  op: ConditionOp
  value: string
}

export interface ConditionContext {
  totalValue: number
  itemCount: number
  priority: string
}

export const CONDITION_FIELDS: { value: ConditionField | 'none'; label: string }[] = [
  { value: 'none', label: 'Always (no condition)' },
  { value: 'totalValue', label: 'Total estimated value' },
  { value: 'itemCount', label: 'Number of items' },
  { value: 'priority', label: 'Request priority' },
]

export const NUMERIC_OPS: { value: ConditionOp; label: string }[] = [
  { value: '>=', label: 'is at least (≥)' },
  { value: '<=', label: 'is at most (≤)' },
  { value: '>', label: 'is greater than (>)' },
  { value: '<', label: 'is less than (<)' },
  { value: '==', label: 'is equal to (=)' },
  { value: '!=', label: 'is not equal to (≠)' },
]

export const PRIORITY_OPS: { value: ConditionOp; label: string }[] = [
  { value: '==', label: 'is' },
  { value: '!=', label: 'is not' },
  { value: 'in', label: 'is one of' },
]

export const PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

const FIELDS: ConditionField[] = ['totalValue', 'itemCount', 'priority']
const OPS: ConditionOp[] = ['==', '!=', '>', '<', '>=', '<=', 'in']

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse a stored condition string. Returns null when the step always applies (or is invalid). */
export function parseStepCondition(raw: string | null | undefined): StepCondition | null {
  if (!raw || typeof raw !== 'string' || raw.trim() === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const { field, op, value } = parsed
  if (!FIELDS.includes(field as ConditionField)) return null
  if (!OPS.includes(op as ConditionOp)) return null
  if (typeof value !== 'string' || value.trim() === '') return null
  return { field: field as ConditionField, op: op as ConditionOp, value: value.trim() }
}

/** Serialize a condition for storage. Returns null for "always applies". */
export function buildStepCondition(field: ConditionField | 'none' | null | undefined, op: ConditionOp, value: string): string | null {
  if (!field || field === 'none') return null
  const v = (value ?? '').trim()
  if (v === '') return null
  return JSON.stringify({ field, op, value: v })
}

/**
 * Validate condition input from the workflow editor.
 * Returns an error message, or null when valid.
 */
export function validateConditionInput(
  field: string | null | undefined,
  op: string | null | undefined,
  value: string | null | undefined
): string | null {
  if (!field || field === 'none') return null
  if (!FIELDS.includes(field as ConditionField)) return 'Unknown condition field'
  if (!op || !OPS.includes(op as ConditionOp)) return 'Unknown condition operator'
  const v = (value ?? '').trim()
  if (v === '') return 'Condition value is required'
  if (v.length > 100) return 'Condition value is too long'
  if (field === 'priority') {
    if (!['==', '!=', 'in'].includes(op)) return 'Priority only supports is / is not / is one of'
    const parts = op === 'in' ? v.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean) : [v.toUpperCase()]
    if (parts.length === 0) return 'Condition value is required'
    for (const p of parts) {
      if (!(PRIORITY_VALUES as readonly string[]).includes(p)) {
        return `Unknown priority "${p}" — use LOW, MEDIUM, HIGH, URGENT`
      }
    }
    return null
  }
  // numeric fields
  if (op === 'in') return 'This field does not support "is one of"'
  if (!/^-?\d+(\.\d+)?$/.test(v)) return 'Condition value must be a number'
  return null
}

function compareNumbers(actual: number, op: ConditionOp, expected: number): boolean {
  switch (op) {
    case '==': return actual === expected
    case '!=': return actual !== expected
    case '>': return actual > expected
    case '<': return actual < expected
    case '>=': return actual >= expected
    case '<=': return actual <= expected
    default: return false
  }
}

/**
 * Does this step apply to a request? A null condition always applies.
 * Unknown/invalid conditions fail open (step applies) so a bad rule can never
 * silently skip an approval.
 */
export function evaluateStepCondition(
  cond: StepCondition | null,
  ctx: ConditionContext
): boolean {
  if (!cond) return true
  try {
    if (cond.field === 'priority') {
      const actual = (ctx.priority || '').toUpperCase()
      if (cond.op === 'in') {
        const wanted = cond.value.split(',').map((p) => p.trim().toUpperCase()).filter(Boolean)
        return wanted.includes(actual)
      }
      if (cond.op === '==') return actual === cond.value.toUpperCase()
      if (cond.op === '!=') return actual !== cond.value.toUpperCase()
      return true
    }
    const expected = Number(cond.value)
    if (!Number.isFinite(expected)) return true
    const actual = cond.field === 'totalValue' ? ctx.totalValue : ctx.itemCount
    return compareNumbers(actual, cond.op, expected)
  } catch {
    return true
  }
}

/** Human-readable summary for the editor, e.g. 'Applies when Total value ≥ 50,000'. */
export function describeStepCondition(raw: string | null | undefined): string | null {
  const cond = parseStepCondition(raw)
  if (!cond) return null
  const fieldLabel =
    cond.field === 'totalValue' ? 'Total value' : cond.field === 'itemCount' ? 'Item count' : 'Priority'
  const opLabel =
    cond.op === '=='
      ? cond.field === 'priority'
        ? 'is'
        : '='
      : cond.op === '!='
        ? cond.field === 'priority'
          ? 'is not'
          : '≠'
        : cond.op === 'in'
          ? 'is one of'
          : cond.op
  const valueLabel =
    cond.field === 'priority'
      ? cond.value
          .split(',')
          .map((p) => p.trim().toUpperCase())
          .filter(Boolean)
          .join(', ')
      : Number(cond.value).toLocaleString()
  return `Applies when ${fieldLabel} ${opLabel} ${valueLabel}`
}
