import { describe, expect, it } from 'vitest'
import { buildCategoryGroups } from '../data/categories'
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

  it('tracks required monthly payments as unpaid until a positive expense is recorded', () => {
    const requiredGroups = buildCategoryGroups([
      {
        id: 'custom-bill',
        groupId: 'home-bills',
        name: 'Additional bill',
        type: 'expense',
      },
    ])
    const summary = summarizeBudget({
      groups: requiredGroups,
      budgets: {},
      activities: [
        { categoryId: 'car:car-insurance', amountCents: 100 },
        { categoryId: 'home-bills:mortgage', amountCents: -100 },
      ],
    })
    const homeBills = summary.byGroup.find((group) => group.id === 'home-bills')
    const car = summary.byGroup.find((group) => group.id === 'car')
    const memberships = summary.byGroup.find((group) => group.id === 'memberships')

    expect(homeBills.hasUnpaidRequiredPayment).toBe(true)
    expect(homeBills.categories.find((category) => category.id === 'home-bills:mortgage'))
      .toMatchObject({ isUnpaidRequiredPayment: true })
    expect(homeBills.categories.find((category) => category.id === 'custom-bill'))
      .toMatchObject({ isUnpaidRequiredPayment: true })
    expect(car.categories.find((category) => category.id === 'car:car-insurance'))
      .toMatchObject({ isUnpaidRequiredPayment: false })
    expect(car.categories.find((category) => category.id === 'car:car-payment'))
      .toMatchObject({ isUnpaidRequiredPayment: true })
    expect(car.categories.find((category) => category.id === 'car:gas'))
      .toMatchObject({ isUnpaidRequiredPayment: false })
    expect(memberships.categories.every((category) => category.isUnpaidRequiredPayment))
      .toBe(true)
  })

  it('does not treat an unused negative fun-money allocation as overspending', () => {
    const summary = summarizeBudget({
      groups,
      budgets: { groceries: 20000, pay: 10000 },
      activities: [],
    })
    const funMoney = summary.byGroup.find((group) => group.id === 'fun')

    expect(funMoney.plannedCents).toBe(-10000)
    expect(funMoney.isOverBudget).toBe(false)
    expect(funMoney.categories.every((category) => !category.isOverBudget)).toBe(true)
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
