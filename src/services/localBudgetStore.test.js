import { describe, expect, it } from 'vitest'
import {
  createInitialBudgetData,
  exportBudgetBackup,
  importBudgetBackup,
  loadBudgetData,
  saveBudgetData,
} from './localBudgetStore'

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

describe('local budget storage', () => {
  it('initializes, saves, and reloads a budget in this browser storage', () => {
    const storage = createMemoryStorage()
    const initial = createInitialBudgetData('2026-11')
    initial.budgetTemplate['home-bills:mortgage'] = 150000

    saveBudgetData(initial, storage)
    const reloaded = loadBudgetData('2026-12', storage)

    expect(reloaded.month).toBe('2026-12')
    expect(reloaded.budgetTemplate['home-bills:mortgage']).toBe(150000)
    expect(reloaded.activities).toEqual([])
  })

  it('exports and restores a validated backup', () => {
    const initial = createInitialBudgetData('2026-11')
    const customCategory = {
      id: 'custom-category-12345678',
      groupId: 'monthly-misc',
      name: 'Pet Care',
      type: 'expense',
    }
    initial.customCategories.push(customCategory)
    initial.budgetTemplate[customCategory.id] = 10000
    initial.categoryNameOverrides['home-bills:mortgage'] = 'Home Loan'
    initial.activities.push({
      id: 'one',
      description: 'Groceries',
      amountCents: 8500,
      categoryId: customCategory.id,
      date: '2026-11-18',
      note: '',
    })

    const restored = importBudgetBackup(exportBudgetBackup(initial))
    expect(restored.activities).toHaveLength(1)
    expect(restored.month).toBe('2026-11')
    expect(restored.customCategories).toEqual([customCategory])
    expect(restored.budgetTemplate[customCategory.id]).toBe(10000)
    expect(restored.categoryNameOverrides['home-bills:mortgage']).toBe('Home Loan')
  })

  it('rejects custom categories with an unsupported group type', () => {
    const invalid = createInitialBudgetData('2026-11')
    invalid.customCategories.push({
      id: 'custom-category-12345678',
      groupId: 'fun-money',
      name: 'Extra Fun',
      type: 'allocation',
    })
    expect(() => importBudgetBackup(JSON.stringify(invalid)))
      .toThrow(/invalid custom category/)
  })

  it('loads backups created before custom categories were supported', () => {
    const legacy = createInitialBudgetData('2026-11')
    delete legacy.customCategories
    delete legacy.categoryNameOverrides

    const restored = importBudgetBackup(JSON.stringify(legacy))
    expect(restored.customCategories).toEqual([])
    expect(restored.categoryNameOverrides).toEqual({})
  })

  it('rejects malformed or out-of-range backup records', () => {
    expect(() => importBudgetBackup('{')).toThrow(/valid JSON/)

    const invalid = createInitialBudgetData('2026-11')
    invalid.activities.push({
      id: 'bad',
      description: 'Bad category',
      amountCents: 100,
      categoryId: 'not-a-category',
      date: '2026-11-18',
    })
    expect(() => importBudgetBackup(JSON.stringify(invalid))).toThrow(/invalid activity/)
  })

  it('reports browser storage write failures instead of hiding them', () => {
    const storage = {
      setItem() {
        throw new Error('quota exceeded')
      },
    }
    expect(() => saveBudgetData(createInitialBudgetData('2026-11'), storage))
      .toThrow(/could not be saved/)
  })
})
