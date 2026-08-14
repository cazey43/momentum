import { describe, expect, it } from 'vitest'
import { NAV_AREAS } from './navigation'

describe('navigation config', () => {
  it('covers the eight primary areas required by the spec', () => {
    expect(NAV_AREAS).toHaveLength(8)
  })

  it('has a unique href per area', () => {
    const hrefs = NAV_AREAS.map((a) => a.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('starts at Today, so the root route is the daily landing view', () => {
    expect(NAV_AREAS[0]?.href).toBe('/')
    expect(NAV_AREAS[0]?.label).toBe('Today')
  })

  it('gives every area a blurb, since empty states render from it', () => {
    for (const area of NAV_AREAS) {
      expect(area.blurb.length).toBeGreaterThan(0)
      expect(area.title.length).toBeGreaterThan(0)
    }
  })
})
