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
      groupId: 'personal-lifestyle',
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

  it('migrates removed insurance categories and custom groups in older backups', () => {
    const legacy = createInitialBudgetData('2026-11')
    legacy.budgetTemplate = {
      'car:car-insurance': 10000,
      'insurance:car-insurance': 2000,
      'insurance:health-insurance': 3000,
      'insurance:dental-insurance': 4000,
      'monthly-misc:healthcare': 5000,
    }
    legacy.activities.push(
      {
        id: 'car-insurance',
        description: 'Car insurance',
        amountCents: 5000,
        categoryId: 'insurance:car-insurance',
        date: '2026-11-18',
      },
      {
        id: 'health-insurance',
        description: 'Health premium',
        amountCents: 2500,
        categoryId: 'insurance:health-insurance',
        date: '2026-11-18',
      },
    )
    legacy.customCategories.push({
      id: 'custom-category-87654321',
      groupId: 'monthly-misc',
      name: 'Books',
      type: 'expense',
    })

    const restored = importBudgetBackup(JSON.stringify(legacy))
    expect(restored.budgetTemplate['car:car-insurance']).toBe(12000)
    expect(restored.budgetTemplate['monthly-misc:healthcare']).toBe(12000)
    expect(restored.activities.map((activity) => activity.categoryId)).toEqual([
      'car:car-insurance',
      'monthly-misc:healthcare',
    ])
    expect(restored.customCategories[0].groupId).toBe('personal-lifestyle')
    expect(restored.budgetTemplate).not.toHaveProperty('insurance:health-insurance')
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

    const invalidDocumentId = createInitialBudgetData('2026-11')
    invalidDocumentId.activities.push({
      id: 'invalid/activity',
      description: 'Groceries',
      amountCents: 100,
      categoryId: 'food:groceries',
      date: '2026-11-18',
    })
    expect(() => importBudgetBackup(JSON.stringify(invalidDocumentId)))
      .toThrow(/invalid activity/)
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
