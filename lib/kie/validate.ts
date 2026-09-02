import type { Constraint, ModelDefinition, ParamDef } from './registry/types.ts'

/**
 * Validates a request `input` against a ModelDefinition.
 *
 * Pure module — no env, no network.
 *
 * This runs BEFORE any API call. It is not redundant with Kie's own validation:
 * a 422 names a field but not why, costs a round trip, and reaches the user as
 * noise. Here we can say "Seedance accepts a first frame OR reference images,
 * not both" — which is the actual answer.
 */

export type IssueCode =
  | 'required'
  | 'unknown_key'
  | 'type'
  | 'enum'
  | 'range'
  | 'step'
  | 'length'
  | 'items'
  | 'constraint'

export interface ValidationIssue {
  /** Absent for whole-payload issues such as constraint violations. */
  key?: string
  code: IssueCode
  message: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
}

/**
 * Whether a value counts as supplied.
 *
 * Empty strings and empty arrays are ABSENT — otherwise a cleared field would
 * still trip a mutual-exclusion rule and the user could not resolve it.
 */
export function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

/** The effective value, falling back to the documented default. */
function resolved(
  input: Record<string, unknown>,
  key: string,
  params: ParamDef[],
): unknown {
  if (key in input && input[key] !== undefined) return input[key]
  return params.find((p) => p.key === key)?.default
}

function typeOk(param: ParamDef, value: unknown): boolean {
  switch (param.type) {
    case 'text':
    case 'string':
    case 'url':
      return typeof value === 'string'
    case 'enum':
      return typeof value === 'string' || typeof value === 'number'
    case 'number':
    case 'seed':
      return typeof value === 'number' && Number.isFinite(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'url[]':
    case 'color[]':
      return Array.isArray(value) && value.every((v) => typeof v === 'string')
    case 'bbox[]':
      return (
        Array.isArray(value) &&
        value.every(
          (v) => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number'),
        )
      )
    case 'object[]':
      return (
        Array.isArray(value) &&
        value.every((v) => typeof v === 'object' && v !== null && !Array.isArray(v))
      )
  }
}

function checkParam(
  param: ParamDef,
  value: unknown,
  issues: ValidationIssue[],
  prefix = '',
): void {
  const key = `${prefix}${param.key}`

  if (!typeOk(param, value)) {
    issues.push({
      key,
      code: 'type',
      message: `${param.label} must be ${describeType(param)}.`,
    })
    return
  }

  if (param.enum && !param.enum.includes(value as string | number)) {
    issues.push({
      key,
      code: 'enum',
      message:
        `${param.label} must be one of ${param.enum.map((v) => JSON.stringify(v)).join(', ')}. ` +
        `Received ${JSON.stringify(value)}.`,
    })
  }

  if (typeof value === 'number') {
    if (param.min !== undefined && value < param.min) {
      issues.push({
        key,
        code: 'range',
        message: `${param.label} must be at least ${param.min}.`,
      })
    }
    if (param.max !== undefined && value > param.max) {
      issues.push({
        key,
        code: 'range',
        message: `${param.label} must be at most ${param.max}.`,
      })
    }
    // Only enforced for whole-number steps — float steps like cfg_scale's 0.1
    // cannot be checked reliably without producing false failures.
    if (
      param.step !== undefined &&
      Number.isInteger(param.step) &&
      param.step > 1 &&
      param.min !== undefined &&
      Number.isInteger(value) &&
      (value - param.min) % param.step !== 0
    ) {
      issues.push({
        key,
        code: 'step',
        message: `${param.label} must be a multiple of ${param.step} starting from ${param.min}.`,
      })
    }
  }

  if (typeof value === 'string') {
    if (param.minLength !== undefined && value.length < param.minLength) {
      issues.push({
        key,
        code: 'length',
        message: `${param.label} must be at least ${param.minLength} characters.`,
      })
    }
    if (param.maxLength !== undefined && value.length > param.maxLength) {
      issues.push({
        key,
        code: 'length',
        message: `${param.label} must be at most ${param.maxLength} characters (currently ${value.length}).`,
      })
    }
  }

  if (Array.isArray(value)) {
    if (param.minItems !== undefined && value.length < param.minItems) {
      issues.push({
        key,
        code: 'items',
        message: `${param.label} needs at least ${param.minItems} item(s).`,
      })
    }
    if (param.maxItems !== undefined && value.length > param.maxItems) {
      issues.push({
        key,
        code: 'items',
        message: `${param.label} accepts at most ${param.maxItems} item(s), got ${value.length}.`,
      })
    }

    if (param.type === 'object[]' && param.fields) {
      value.forEach((entry, index) => {
        const row = entry as Record<string, unknown>
        for (const field of param.fields!) {
          const fieldValue = row[field.key]
          if (!isPresent(fieldValue)) {
            if (field.required) {
              issues.push({
                key: `${key}[${index}].${field.key}`,
                code: 'required',
                message: `${param.label} item ${index + 1}: ${field.label} is required.`,
              })
            }
            continue
          }
          checkParam(field, fieldValue, issues, `${key}[${index}].`)
        }
      })
    }
  }
}

function describeType(param: ParamDef): string {
  switch (param.type) {
    case 'number':
    case 'seed':
      return 'a number'
    case 'boolean':
      return 'true or false'
    case 'url[]':
    case 'color[]':
      return 'an array of strings'
    case 'bbox[]':
      return 'an array of [x1, y1, x2, y2] number arrays'
    case 'object[]':
      return 'an array of objects'
    default:
      return 'a string'
  }
}

function checkConstraint(
  constraint: Constraint,
  input: Record<string, unknown>,
  params: ParamDef[],
  issues: ValidationIssue[],
): void {
  const present = (key: string) => isPresent(input[key])

  switch (constraint.kind) {
    case 'mutuallyExclusive': {
      const set = constraint.keys.filter(present)
      if (set.length > 1) {
        issues.push({ code: 'constraint', message: constraint.message })
      }
      break
    }
    case 'mutuallyExclusiveGroups': {
      const active = constraint.groups.filter((group) => group.some(present))
      if (active.length > 1) {
        issues.push({ code: 'constraint', message: constraint.message })
      }
      break
    }
    case 'requiresOneOf': {
      if (!constraint.keys.some(present)) {
        issues.push({ code: 'constraint', message: constraint.message })
      }
      break
    }
    case 'requiredWhen': {
      if (resolved(input, constraint.when.key, params) === constraint.when.equals) {
        for (const key of constraint.keys) {
          if (!present(key)) {
            issues.push({ key, code: 'constraint', message: constraint.message })
          }
        }
      }
      break
    }
    case 'forbiddenWhen': {
      if (resolved(input, constraint.when.key, params) === constraint.when.equals) {
        for (const key of constraint.keys) {
          if (present(key)) {
            issues.push({ key, code: 'constraint', message: constraint.message })
          }
        }
      }
      break
    }
    case 'requires': {
      if (constraint.keys.some(present) && !present(constraint.requires)) {
        issues.push({ code: 'constraint', message: constraint.message })
      }
      break
    }
    case 'maxWhen': {
      if (resolved(input, constraint.when.key, params) === constraint.when.equals) {
        for (const key of constraint.keys) {
          const value = input[key]
          if (typeof value === 'number' && value > constraint.max) {
            issues.push({ key, code: 'constraint', message: constraint.message })
          }
        }
      }
      break
    }
  }
}

/**
 * Validates `input` against `model`.
 *
 * Reports every issue rather than stopping at the first — the form shows them
 * all at once.
 */
export function validateInput(
  model: ModelDefinition,
  input: Record<string, unknown>,
): ValidationResult {
  const issues: ValidationIssue[] = []
  const known = new Set(model.params.map((p) => p.key))

  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      issues.push({
        key,
        code: 'unknown_key',
        message: `${model.slug} has no parameter "${key}".`,
      })
    }
  }

  for (const param of model.params) {
    const value = input[param.key]

    if (!isPresent(value)) {
      // A documented default satisfies a required field — the API applies it.
      if (param.required && param.default === undefined) {
        issues.push({
          key: param.key,
          code: 'required',
          message: `${param.label} is required.`,
        })
      }
      continue
    }

    checkParam(param, value, issues)
  }

  for (const constraint of model.constraints ?? []) {
    checkConstraint(constraint, input, model.params, issues)
  }

  return { ok: issues.length === 0, issues }
}

/** Convenience for callers that only need a yes/no. */
export function isValidInput(
  model: ModelDefinition,
  input: Record<string, unknown>,
): boolean {
  return validateInput(model, input).ok
}
