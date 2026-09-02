import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { GENERATION_STATES } from '../db/schema.ts'
import {
  DEFAULT_PAGE_SIZE,
  FILTERABLE_STATES,
  STATE_GROUPS,
  galleryHref,
  isFilterActive,
  parseGalleryFilter,
  serializeGalleryFilter,
  statesFor,
  toDateInput,
  withFilter,
} from './filters.ts'

const parse = (query: string) => parseGalleryFilter(new URLSearchParams(query))

describe('FILTERABLE_STATES', () => {
  it('covers every state the schema defines', () => {
    // filters.ts declares this list itself so it carries no runtime dependency
    // on drizzle. `satisfies` catches an invented state; only this catches a
    // state added to the schema and forgotten here, which would silently make
    // some generations unfilterable.
    assert.deepEqual([...FILTERABLE_STATES].sort(), [...GENERATION_STATES].sort())
  })

  it('sorts every non-draft state into exactly one group', () => {
    const grouped = Object.values(STATE_GROUPS).flat()
    assert.equal(new Set(grouped).size, grouped.length, 'no state is in two groups')

    const ungrouped = GENERATION_STATES.filter((s) => !grouped.includes(s as never))
    // `draft` is the only one: it was never submitted, so it is not an outcome.
    assert.deepEqual(ungrouped, ['draft'])
  })
})

describe('parseGalleryFilter', () => {
  it('defaults to an unfiltered first page', () => {
    const filter = parse('')
    assert.equal(filter.page, 1)
    assert.equal(filter.pageSize, DEFAULT_PAGE_SIZE)
    assert.equal(isFilterActive(filter), false)
  })

  it('reads the registry-backed filters', () => {
    const filter = parse('family=wan&capability=text-to-image&model=wan/2-7-image')
    assert.equal(filter.family, 'wan')
    assert.equal(filter.capability, 'text-to-image')
    assert.equal(filter.model, 'wan/2-7-image')
    assert.equal(isFilterActive(filter), true)
  })

  it('drops values the registry does not know', () => {
    // A hand-edited URL should show everything, not an empty grid that reads
    // as data loss.
    const filter = parse('family=openai&capability=telepathy&state=exploded')
    assert.equal(filter.family, undefined)
    assert.equal(filter.capability, undefined)
    assert.equal(filter.state, undefined)
    assert.equal(filter.stateGroup, undefined)
    assert.equal(isFilterActive(filter), false)
  })

  it('reads a state group in preference to an exact state', () => {
    const filter = parse('state=problem')
    assert.equal(filter.stateGroup, 'problem')
    assert.equal(filter.state, undefined)
    assert.deepEqual(statesFor(filter), ['failed', 'needs_retry', 'stalled', 'orphaned'])
  })

  it('still accepts one exact state', () => {
    const filter = parse('state=stalled')
    assert.equal(filter.state, 'stalled')
    assert.deepEqual(statesFor(filter), ['stalled'])
  })

  it('treats a missing state as no state constraint', () => {
    assert.equal(statesFor(parse('')), undefined)
  })

  it('reads favorite only as an explicit 1', () => {
    assert.equal(parse('favorite=1').favorite, true)
    assert.equal(parse('favorite=0').favorite, undefined)
    assert.equal(parse('favorite=true').favorite, undefined)
  })

  it('makes the `to` bound inclusive of its whole day', () => {
    const filter = parse('from=2026-09-01&to=2026-09-01')
    assert.equal(new Date(filter.createdFrom!).getHours(), 0)
    // A generation at 23:59 on the `to` day must be inside the range.
    assert.equal(filter.createdTo! - filter.createdFrom!, 24 * 60 * 60 * 1000 - 1)
  })

  it('rejects a date that does not exist', () => {
    assert.equal(parse('from=2026-02-31').createdFrom, undefined)
    assert.equal(parse('from=not-a-date').createdFrom, undefined)
  })

  it('clamps paging to sane bounds', () => {
    assert.equal(parse('page=0').page, 1)
    assert.equal(parse('page=-5').page, 1)
    assert.equal(parse('page=abc').page, 1)
    assert.equal(parse('pageSize=99999').pageSize, 200)
    assert.equal(parse('pageSize=12').pageSize, 12)
  })

  it('accepts the plain object Next hands a server component', () => {
    const filter = parseGalleryFilter({ family: 'kling', page: '3' })
    assert.equal(filter.family, 'kling')
    assert.equal(filter.page, 3)
  })

  it('takes the first value when a key repeats', () => {
    assert.equal(parseGalleryFilter({ family: ['wan', 'kling'] }).family, 'wan')
  })
})

describe('serializeGalleryFilter', () => {
  it('round-trips through the URL', () => {
    const original = parse('family=kling&state=problem&q=lemon&favorite=1&page=2')
    const round = parse(serializeGalleryFilter(original))
    assert.deepEqual(round, original)
  })

  it('omits defaults, so an unfiltered gallery has a clean URL', () => {
    assert.equal(galleryHref(parse('')), '/gallery')
  })

  it('round-trips a date range', () => {
    const original = parse('from=2026-08-01&to=2026-09-01')
    const round = parse(serializeGalleryFilter(original))
    assert.equal(round.createdFrom, original.createdFrom)
    assert.equal(round.createdTo, original.createdTo)
  })
})

describe('withFilter', () => {
  it('returns to page 1 when a filter changes', () => {
    // Narrowing while on page 4 would otherwise land on an empty grid that
    // reads as "no results".
    const filter = parse('page=4')
    assert.equal(withFilter(filter, { family: 'wan' }).page, 1)
  })

  it('keeps the page when the page is what changed', () => {
    assert.equal(withFilter(parse('family=wan'), { page: 3 }).page, 3)
  })
})

describe('toDateInput', () => {
  it('formats for a date input', () => {
    assert.equal(toDateInput(new Date(2026, 8, 1).getTime()), '2026-09-01')
  })

  it('is empty for an absent bound', () => {
    assert.equal(toDateInput(undefined), '')
  })
})

describe('the NSFW filter', () => {
  it('is off unless the URL says otherwise', () => {
    assert.equal(parse('').nsfw, undefined)
    assert.equal(parse('family=wan').nsfw, undefined)
    // Anything but an exact "1" is not a request to show marked work.
    assert.equal(parse('nsfw=0').nsfw, undefined)
    assert.equal(parse('nsfw=true').nsfw, undefined)
    assert.equal(parse('nsfw=yes').nsfw, undefined)
  })

  it('survives a round trip through the URL', () => {
    const filter = parse('nsfw=1&family=wan')
    assert.equal(filter.nsfw, true)
    assert.match(serializeGalleryFilter(filter), /nsfw=1/)
  })

  it('leaves a clean URL when it is off', () => {
    assert.equal(serializeGalleryFilter(parse('')).includes('nsfw'), false)
  })
})
