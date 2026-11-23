import { describe, expect, it } from 'vitest'
import { categoryGroups } from '../data/categories'
import { importBudgetCsv } from './csvImport'

describe('importBudgetCsv', () => {
  it('imports category budgets by section and keeps duplicate labels separate', () => {
    const csv = [
      'HOME/BILLS,',
      'Mortgage,"$1,500.00"',
      'Gas,80.25',
      'TOTAL MONTHLY HOUSE,1580.25',
      'CAR,',
      'Gas,100.00',
      'Car Insurance,0',
      'MONTHLY,',
      'INSURANCE,',
      'Car Insurance,25.00',
      'MONTHLY SAVINGS,',
      'Joint Savings,200',
      'FUN MONEY,',
      'Marcus Fun Money,0',
    ].join('\r\n')

    const result = importBudgetCsv(csv)

    expect(result.budgetByCategoryId['home-bills:mortgage']).toBe(150000)
    expect(result.budgetByCategoryId['home-bills:gas']).toBe(8025)
    expect(result.budgetByCategoryId['car:gas']).toBe(10000)
    expect(result.budgetByCategoryId['insurance:car-insurance']).toBe(2500)
    expect(result.budgetByCategoryId['savings:joint-savings']).toBe(20000)
    expect(result.budgetByCategoryId['fun-money:marcus-fun-money']).toBe(0)
  })

  it('accepts the workbook spelling alias for Healthcare', () => {
    const result = importBudgetCsv('MONTHLY MISC,\nHeathcare,125')
    expect(
      result.budgetByCategoryId['monthly-misc:healthcare'],
    ).toBe(12500)
  })

  it('imports a user-defined category when current categories are provided', () => {
    const groupsWithCustomCategory = categoryGroups.map((group) => ({
      ...group,
      categories: [...group.categories],
    }))
    const monthlyMisc = groupsWithCustomCategory.find(
      (group) => group.id === 'monthly-misc',
    )
    monthlyMisc.categories.push({
      id: 'custom-category-12345678',
      groupId: 'monthly-misc',
      name: 'Pet Care',
      type: 'expense',
    })

    const result = importBudgetCsv(
      'MONTHLY MISC,\nPet Care,125',
      groupsWithCustomCategory,
    )
    expect(result.budgetByCategoryId['custom-category-12345678']).toBe(12500)
  })

  it('reports unrecognized rows and fails when there are no budgets', () => {
    const result = importBudgetCsv('HOME/BILLS,\nMortgage,100\nA new item,10')
    expect(result.unmatchedRows).toContain('A new item')

    expect(() => importBudgetCsv('not a budget')).toThrow(
      /No category budgets were found/,
    )
  })

  it('supports commas and quotes in quoted labels and rejects malformed CSV', () => {
    const result = importBudgetCsv(
      'MONTHLY MISC,\nRestaurants/Bars,10\n"Restaurants/Bars, special",10',
    )
    expect(result.unmatchedRows).toContain('Restaurants/Bars, special')
    expect(() => importBudgetCsv('HOME/BILLS,\n"Mortgage,1')).toThrow(
      /unfinished quoted field/,
    )
  })
})
