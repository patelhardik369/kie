import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_OUTPUT_LIMIT,
  MAX_OUTPUT_LIMIT,
  clampLimit,
} from './outputs.ts'

/**
 * These exist because of a real bug, not for coverage.
 *
 * `Number(searchParams.get('limit'))` on a parameter that was never sent is
 * `Number(null)` === `0`. Zero is finite, so it walks straight through an
 * `isFinite` guard, and `Math.max(1, 0)` then pins the page size to ONE row. The
 * outputs picker rendered a single thumbnail and read as a broken filter — the
 * private images were there the whole time, just past a limit of one.
 *
 * The first case below is that bug.
 */
describe('clampLimit', () => {
  it('defaults when the parameter was never sent', () => {
    // searchParams.get() returns null, NOT undefined. Number(null) is 0.
    assert.equal(clampLimit(null), DEFAULT_OUTPUT_LIMIT)
    assert.equal(clampLimit(undefined), DEFAULT_OUTPUT_LIMIT)
  })

  it('defaults on a blank or non-numeric value', () => {
    // Number('') is also 0 — the same trap wearing a different hat.
    assert.equal(clampLimit(''), DEFAULT_OUTPUT_LIMIT)
    assert.equal(clampLimit('   '), DEFAULT_OUTPUT_LIMIT)
    assert.equal(clampLimit('all'), DEFAULT_OUTPUT_LIMIT)
    assert.equal(clampLimit('NaN'), DEFAULT_OUTPUT_LIMIT)
  })

  it('defaults rather than returning an empty or negative page', () => {
    assert.equal(clampLimit('0'), DEFAULT_OUTPUT_LIMIT)
    assert.equal(clampLimit('-5'), DEFAULT_OUTPUT_LIMIT)
  })

  it('honours a real count', () => {
    assert.equal(clampLimit('1'), 1)
    assert.equal(clampLimit('12'), 12)
    // Floored, not rounded: 12.9 rows is 12 rows.
    assert.equal(clampLimit('12.9'), 12)
  })

  it('caps at the ceiling', () => {
    assert.equal(clampLimit(String(MAX_OUTPUT_LIMIT + 1)), MAX_OUTPUT_LIMIT)
    assert.equal(clampLimit('99999'), MAX_OUTPUT_LIMIT)
    assert.equal(clampLimit('Infinity'), DEFAULT_OUTPUT_LIMIT)
  })
})
