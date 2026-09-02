import type { ModelDefinition } from './registry/types.ts'
import { isPresent, whenHolds } from './validate.ts'

/**
 * Turns a model's constraints into per-field UI state.
 *
 * Pure module — no env, no React. The form imports this to *prevent* invalid
 * states rather than report them afterwards (docs/UX-SPEC.md: "prevent, don't
 * reject"). A disabled control always carries the reason it is disabled.
 */

export interface DerivedField {
  /** The control is unusable right now because another choice excludes it. */
  disabled: boolean
  /** User-facing explanation. Always set when `disabled` is true. */
  reason?: string
  /** Required in the CURRENT state — may differ from the static ParamDef. */
  required: boolean
  /** Ceiling in the current state, when a constraint lowers it. */
  max?: number
}

export type DerivedFields = Record<string, DerivedField>

export function deriveFields(
  model: ModelDefinition,
  values: Record<string, unknown>,
): DerivedFields {
  const fields: DerivedFields = {}

  for (const param of model.params) {
    fields[param.key] = {
      disabled: false,
      required: Boolean(param.required),
      ...(param.max !== undefined ? { max: param.max } : {}),
    }
  }

  const present = (key: string) => isPresent(values[key])
  const disable = (key: string, reason: string) => {
    const field = fields[key]
    // First reason wins — it is the one the user acted on most directly.
    if (field && !field.disabled) {
      field.disabled = true
      field.reason = reason
    }
  }

  for (const constraint of model.constraints ?? []) {
    switch (constraint.kind) {
      case 'mutuallyExclusive': {
        const chosen = constraint.keys.find(present)
        if (chosen) {
          for (const key of constraint.keys) {
            if (key !== chosen) disable(key, constraint.message)
          }
        }
        break
      }

      case 'mutuallyExclusiveGroups': {
        const activeIndex = constraint.groups.findIndex((group) => group.some(present))
        if (activeIndex >= 0) {
          constraint.groups.forEach((group, index) => {
            if (index === activeIndex) return
            for (const key of group) disable(key, constraint.message)
          })
        }
        break
      }

      case 'requiredWhen': {
        if (whenHolds(constraint.when, values, model.params)) {
          for (const key of constraint.keys) {
            const field = fields[key]
            if (field) field.required = true
          }
        }
        break
      }

      case 'forbiddenWhen': {
        if (whenHolds(constraint.when, values, model.params)) {
          for (const key of constraint.keys) disable(key, constraint.message)
        }
        break
      }

      case 'maxWhen': {
        if (whenHolds(constraint.when, values, model.params)) {
          for (const key of constraint.keys) {
            const field = fields[key]
            if (field) field.max = constraint.max
          }
        }
        break
      }

      // `requiresOneOf` and `requires` describe combinations that are only
      // knowable at submit time — disabling a control for them would block the
      // user from ever satisfying the rule. The validator reports them instead.
      case 'requiresOneOf':
      case 'requires':
        break
    }
  }

  return fields
}

/**
 * Constraint messages that apply to the whole payload rather than one field, for
 * display above the submit button.
 */
export function pendingRequirements(
  model: ModelDefinition,
  values: Record<string, unknown>,
): string[] {
  const messages: string[] = []
  const present = (key: string) => isPresent(values[key])

  for (const constraint of model.constraints ?? []) {
    if (constraint.kind === 'requiresOneOf' && !constraint.keys.some(present)) {
      messages.push(constraint.message)
    }
    if (
      constraint.kind === 'requires' &&
      constraint.keys.some(present) &&
      !present(constraint.requires)
    ) {
      messages.push(constraint.message)
    }
  }

  return messages
}
