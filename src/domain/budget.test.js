import { describe, expect, it } from 'vitest'
import {
  getPreviousMonthKey,
  parseMoneyToCents,
  summarizeBudget,
} from './budget'

const groups = [
  {
    id: 'spend',
    type: 'expense',
    categories: [{ id: 'groceries', name: 'Groceries' }],
  },
  {
    id: 'debt',
    type: 'debt',
    categories: [{ id: 'loan', name: 'Loan' }],
  },
  {
    id: 'savings',
    type: 'savings',
    categories: [{ id: 'savings', name: 'Savings' }],
  },
  {
    id: 'income',
    type: 'income',
    categories: [{ id: 'pay', name: 'Pay', type: 'income' }],
  },
  {
    id: 'fun',
    type: 'allocation',
    categories: [{ id: 'fun-a', name: 'Fun A' }, { id: 'fun-b', name: 'Fun B' }],
  },
]

describe('summarizeBudget', () => {
  it('calculates actuals, surplus, equal fun money, and ending balance in cents', () => {
    const summary = summarizeBudget({
      groups,
      budgets: {
        groceries: 30000,
        loan: 10000,
        savings: 20000,
        pay: 100000,
      },
      activities: [
        { categoryId: 'groceries', amountCents: 3200 },
        { categoryId: 'loan', amountCents: 500 },
        { categoryId: 'savings', amountCents: 1500 },
        { categoryId: 'pay', amountCents: 50000 },
        { categoryId: 'fun-a', amountCents: 1000 },
      ],
    })

    expect(summary.plannedSurplusCents).toBe(40000)
    expect(summary.actualSurplusCents).toBe(44800)
    expect(summary.perPersonFunMoneyCents).toBe(20000)
    expect(summary.actualFunMoneyCents).toBe(1000)
    expect(summary.endingBalanceCents).toBe(4800)
    expect(summary.actualExpensesCents).toBe(3700)
  })

  it('splits odd cents without losing the total', () => {
    const summary = summarizeBudget({
      groups,
      budgets: { pay: 1 },
      activities: [],
    })
    expect(summary.perPersonFunMoneyCents).toBe(0)
    expect(summary.plannedFunMoneyCents).toBe(1)
    expect(summary.plannedSurplusCents).toBe(1)
  })

  it('flags actuals above plan except when the category is income', () => {
    const summary = summarizeBudget({
      groups,
      budgets: { groceries: 1000, pay: 1000 },
      activities: [
        { categoryId: 'groceries', amountCents: 1001 },
        { categoryId: 'pay', amountCents: 2000 },
      ],
    })

    const groceryCategory = summary.byGroup[0].categories[0]
    const incomeGroup = summary.byGroup.find((group) => group.type === 'income')
    const incomeCategory = incomeGroup.categories[0]
    expect(groceryCategory.isOverBudget).toBe(true)
    expect(summary.byGroup[0].isOverBudget).toBe(true)
    expect(incomeCategory.isOverBudget).toBe(false)
    expect(incomeGroup.isOverBudget).toBe(false)
  })
})

describe('parseMoneyToCents', () => {
  it.each([
    ['$1,234.56', 123456],
    ['(23.10)', -2310],
    ['0', 0],
    ['', null],
    ['not a number', null],
  ])('parses %s', (value, expected) => {
    expect(parseMoneyToCents(value)).toBe(expected)
  })
})

describe('getPreviousMonthKey', () => {
  it('handles year boundaries', () => {
    expect(getPreviousMonthKey('2027-01')).toBe('2026-12')
    expect(getPreviousMonthKey('2026-11')).toBe('2026-10')
  })
})
