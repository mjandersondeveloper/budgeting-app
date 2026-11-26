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
    categories: [{ id: 'savings', name: 'Savings', type: 'savings' }],
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
    expect(summary.perPersonFunMoneyCents).toBe(22400)
    expect(summary.actualFunMoneyCents).toBe(1000)
    expect(summary.endingBalanceCents).toBe(4800)
    expect(summary.actualExpensesCents).toBe(3700)
    expect(summary.plannedFunMoneyCents).toBe(44800)
    expect(summary.byGroup.find((group) => group.id === 'fun').categories
      .map((category) => category.plannedCents)).toEqual([22400, 22400])
  })

  it('splits odd cents without losing the total', () => {
    const summary = summarizeBudget({
      groups,
      budgets: { pay: 1 },
      activities: [{ categoryId: 'pay', amountCents: 1 }],
    })
    expect(summary.perPersonFunMoneyCents).toBe(0)
    expect(summary.plannedFunMoneyCents).toBe(1)
    expect(summary.plannedSurplusCents).toBe(1)
    expect(summary.byGroup.find((group) => group.id === 'fun').categories
      .map((category) => category.plannedCents)).toEqual([1, 0])
  })

  it('flags overspending but not income or savings above plan', () => {
    const summary = summarizeBudget({
      groups,
      budgets: { groceries: 1000, savings: 1000, pay: 1000 },
      activities: [
        { categoryId: 'groceries', amountCents: 1001 },
        { categoryId: 'savings', amountCents: 2000 },
        { categoryId: 'pay', amountCents: 2000 },
      ],
    })

    const groceryCategory = summary.byGroup[0].categories[0]
    const savingsGroup = summary.byGroup.find((group) => group.type === 'savings')
    const savingsCategory = savingsGroup.categories[0]
    const incomeGroup = summary.byGroup.find((group) => group.type === 'income')
    const incomeCategory = incomeGroup.categories[0]
    expect(groceryCategory.isOverBudget).toBe(true)
    expect(summary.byGroup[0].isOverBudget).toBe(true)
    expect(savingsCategory.isOverBudget).toBe(false)
    expect(savingsGroup.isOverBudget).toBe(false)
    expect(incomeCategory.isOverBudget).toBe(false)
    expect(incomeGroup.isOverBudget).toBe(false)
  })

  it('marks required entries only when the planned amount is positive and no value is recorded', () => {
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
      budgets: {
        'home-bills:mortgage': 100,
        'home-bills:internet': 0,
        'custom-bill': 100,
        'car:car-insurance': 100,
        'car:car-payment': 100,
        'memberships:spotify': 50,
        'savings:joint-savings': 200,
        'savings:joint-stocks': 0,
        'income:marcus-after-tax-income': 300,
        'income:alexa-after-tax-income': 300,
        'income:extra-income': 300,
      },
      activities: [
        { categoryId: 'car:car-insurance', amountCents: 100 },
        { categoryId: 'home-bills:mortgage', amountCents: -100 },
        { categoryId: 'income:marcus-after-tax-income', amountCents: 300 },
      ],
    })
    const homeBills = summary.byGroup.find((group) => group.id === 'home-bills')
    const car = summary.byGroup.find((group) => group.id === 'car')
    const memberships = summary.byGroup.find((group) => group.id === 'memberships')
    const savings = summary.byGroup.find((group) => group.id === 'savings')
    const income = summary.byGroup.find((group) => group.id === 'income')

    expect(homeBills.hasMissingRequiredEntry).toBe(true)
    expect(homeBills.categories.find((category) => category.id === 'home-bills:mortgage'))
      .toMatchObject({ isMissingRequiredEntry: true })
    expect(homeBills.categories.find((category) => category.id === 'home-bills:internet'))
      .toMatchObject({ isMissingRequiredEntry: false })
    expect(homeBills.categories.find((category) => category.id === 'custom-bill'))
      .toMatchObject({ isMissingRequiredEntry: true })
    expect(car.categories.find((category) => category.id === 'car:car-insurance'))
      .toMatchObject({ isMissingRequiredEntry: false })
    expect(car.categories.find((category) => category.id === 'car:car-payment'))
      .toMatchObject({ isMissingRequiredEntry: true })
    expect(car.categories.find((category) => category.id === 'car:gas'))
      .toMatchObject({ isMissingRequiredEntry: false })
    expect(memberships.categories.find((category) => category.id === 'memberships:spotify'))
      .toMatchObject({ isMissingRequiredEntry: true })
    expect(memberships.categories.find((category) => category.id === 'memberships:netflix'))
      .toMatchObject({ isMissingRequiredEntry: false })
    expect(savings.categories.find((category) => category.id === 'savings:joint-savings'))
      .toMatchObject({ isMissingRequiredEntry: true })
    expect(savings.categories.find((category) => category.id === 'savings:joint-stocks'))
      .toMatchObject({ isMissingRequiredEntry: false })
    expect(income.categories.find((category) => category.id === 'income:marcus-after-tax-income'))
      .toMatchObject({ isMissingRequiredEntry: false })
    expect(income.categories.find((category) => category.id === 'income:alexa-after-tax-income'))
      .toMatchObject({ isMissingRequiredEntry: true })
    expect(income.categories.find((category) => category.id === 'income:extra-income'))
      .toMatchObject({ isMissingRequiredEntry: false })
  })

  it('does not treat fun-money allocations as required entries', () => {
    const categoryGroups = buildCategoryGroups()
    const summary = summarizeBudget({
      groups: categoryGroups,
      budgets: {},
      activities: [
        { categoryId: 'income:marcus-after-tax-income', amountCents: 10000 },
      ],
    })
    const funMoney = summary.byGroup.find(
      (group) => group.id === 'fun-money',
    )

    expect(funMoney.categories.map((category) => category.plannedCents))
      .toEqual([5000, 5000])
    expect(funMoney.categories.every((category) => !category.requiresMonthlyEntry))
      .toBe(true)
    expect(funMoney.categories.every((category) => !category.isMissingRequiredEntry))
      .toBe(true)
    expect(funMoney.hasMissingRequiredEntry).toBe(false)
  })

  it('does not treat an unused negative fun-money allocation as overspending', () => {
    const summary = summarizeBudget({
      groups,
      budgets: { groceries: 1000, pay: 1000 },
      activities: [
        { categoryId: 'groceries', amountCents: 20000 },
        { categoryId: 'pay', amountCents: 10000 },
      ],
    })
    const funMoney = summary.byGroup.find((group) => group.id === 'fun')

    expect(funMoney.plannedCents).toBe(-10000)
    expect(funMoney.isOverBudget).toBe(false)
    expect(funMoney.categories.every((category) => !category.isOverBudget)).toBe(true)
  })

  it('treats Credits as income in the monthly summary', () => {
    const credits = buildCategoryGroups()
      .find((group) => group.id === 'income')
      .categories.find((category) => category.id === 'income:credits')
    const summary = summarizeBudget({
      groups: buildCategoryGroups(),
      budgets: {},
      activities: [{ categoryId: 'income:credits', amountCents: 2450 }],
    })

    expect(credits).toMatchObject({ name: 'Credits', type: 'income' })
    expect(summary.actualIncomeCents).toBe(2450)
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
