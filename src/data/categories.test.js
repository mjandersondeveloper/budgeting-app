import { describe, expect, it } from 'vitest'
import { categories, categoryGroups } from './categories'

describe('budget category groups', () => {
  it('keeps car insurance and future car payments under Car', () => {
    const car = categoryGroups.find((group) => group.id === 'car')
    expect(car.categories.map((category) => category.name)).toContain('Car Insurance')
    expect(car.categories.map((category) => category.name)).toContain('Car Payment')
    expect(categories.some((category) => category.id === 'insurance:car-insurance')).toBe(false)
  })

  it('splits the former miscellaneous categories into focused groups', () => {
    expect(categoryGroups.map((group) => group.name)).toEqual(expect.arrayContaining([
      'Food & Dining',
      'Home & Household',
      'Personal & Lifestyle',
      'Travel',
      'Pets',
    ]))
    expect(categoryGroups.some((group) => group.id === 'insurance')).toBe(false)
  })

  it('keeps debt specific and clearly labels its fallback category', () => {
    const debt = categoryGroups.find((group) => group.id === 'debt')
    expect(debt.categories).toEqual([
      expect.objectContaining({
        id: 'debt:debt',
        name: 'Other Debt Payment',
        aliases: ['Debt'],
      }),
    ])
  })
})
