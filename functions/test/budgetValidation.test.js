import assert from 'node:assert/strict'
import test from 'node:test'
import { validateBudgetData } from '../src/budgetValidation.js'

function makeBudgetData(overrides = {}) {
  return {
    budgetTemplate: { 'home:mortgage': 120000 },
    budgetsByMonth: { '2026-01': { 'home:mortgage': 120000 } },
    activities: [],
    customCategories: [],
    categoryNameOverrides: {},
    ...overrides,
  }
}

function makeActivity(id) {
  return {
    id,
    description: 'Groceries',
    amountCents: 5234,
    categoryId: 'food:groceries',
    date: '2026-01-12',
    note: '',
  }
}

test('accepts a valid budget backup', () => {
  assert.doesNotThrow(() => validateBudgetData(makeBudgetData()))
})

test('rejects invalid monthly budgets and duplicate activity IDs', () => {
  assert.throws(
    () => validateBudgetData(makeBudgetData({
      budgetsByMonth: { '2026-13': { 'home:mortgage': 120000 } },
    })),
    { code: 'invalid-argument' },
  )

  assert.throws(
    () => validateBudgetData(makeBudgetData({
      activities: [makeActivity('same-id'), makeActivity('same-id')],
    })),
    { code: 'invalid-argument' },
  )
})

test('rejects local imports that would exceed Firestore transaction limits', () => {
  const activities = Array.from({ length: 500 }, (_, index) =>
    makeActivity(`activity-${index}`),
  )

  assert.throws(
    () => validateBudgetData(makeBudgetData({ activities })),
    { code: 'failed-precondition' },
  )
})
