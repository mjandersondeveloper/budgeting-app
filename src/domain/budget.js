export function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function getMonthLabel(monthKey, locale = 'en-US') {
  const [year, month] = monthKey.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month - 1, 1))
}

export function getPreviousMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number)
  return getCurrentMonthKey(new Date(year, month - 2, 1))
}

export function formatMoney(cents, options = {}) {
  return new Intl.NumberFormat(options.locale ?? 'en-US', {
    style: 'currency',
    currency: options.currency ?? 'USD',
    maximumFractionDigits: 2,
  }).format((cents ?? 0) / 100)
}

function exceedsPlan(type, actualCents, plannedCents) {
  if (type === 'income') return false
  const applicablePlan = type === 'allocation' ? Math.max(0, plannedCents) : plannedCents
  return actualCents > applicablePlan
}

export function summarizeBudget({ groups, budgets, activities }) {
  const actuals = {}

  for (const activity of activities) {
    actuals[activity.categoryId] =
      (actuals[activity.categoryId] ?? 0) + activity.amountCents
  }

  const byGroup = groups.map((group) => {
    const plannedCents = group.categories.reduce(
      (total, category) => total + (budgets[category.id] ?? 0),
      0,
    )
    const actualCents = group.categories.reduce(
      (total, category) => total + (actuals[category.id] ?? 0),
      0,
    )

    const categories = group.categories.map((category) => {
      const categoryPlannedCents = budgets[category.id] ?? 0
      const categoryActualCents = actuals[category.id] ?? 0
      const requiresMonthlyPayment = Boolean(category.requiresMonthlyPayment)

      return {
        ...category,
        plannedCents: categoryPlannedCents,
        actualCents: categoryActualCents,
        remainingCents: categoryPlannedCents - categoryActualCents,
        isOverBudget: exceedsPlan(
          category.type,
          categoryActualCents,
          categoryPlannedCents,
        ),
        isUnpaidRequiredPayment:
          requiresMonthlyPayment && categoryActualCents <= 0,
      }
    })

    return {
      ...group,
      plannedCents,
      actualCents,
      remainingCents: plannedCents - actualCents,
      isOverBudget: exceedsPlan(group.type, actualCents, plannedCents),
      hasUnpaidRequiredPayment: categories.some(
        (category) => category.isUnpaidRequiredPayment,
      ),
      categories,
    }
  })

  const groupTotal = (type, key) =>
    byGroup
      .filter((group) => group.type === type)
      .reduce((total, group) => total + group[key], 0)

  const plannedExpensesCents = groupTotal('expense', 'plannedCents')
  const actualExpensesCents = groupTotal('expense', 'actualCents')
  const plannedDebtCents = groupTotal('debt', 'plannedCents')
  const actualDebtCents = groupTotal('debt', 'actualCents')
  const plannedSavingsCents = groupTotal('savings', 'plannedCents')
  const actualSavingsCents = groupTotal('savings', 'actualCents')
  const plannedIncomeCents = groupTotal('income', 'plannedCents')
  const actualIncomeCents = groupTotal('income', 'actualCents')
  const plannedSurplusCents =
    plannedIncomeCents -
    plannedExpensesCents -
    plannedDebtCents -
    plannedSavingsCents
  const actualSurplusCents =
    actualIncomeCents - actualExpensesCents - actualDebtCents - actualSavingsCents
  const perPersonFunMoneyCents = Math.trunc(plannedSurplusCents / 2)
  const firstFunMoneyCents =
    perPersonFunMoneyCents + (plannedSurplusCents % 2)

  for (const group of byGroup) {
    if (group.type !== 'allocation') continue
    group.categories = group.categories.map((category, index) => {
      const plannedCents = index === 0 ? firstFunMoneyCents : perPersonFunMoneyCents
      return {
        ...category,
        plannedCents,
        remainingCents: plannedCents - category.actualCents,
        isOverBudget: exceedsPlan('allocation', category.actualCents, plannedCents),
      }
    })
    group.plannedCents = group.categories.reduce(
      (total, category) => total + category.plannedCents,
      0,
    )
    group.isOverBudget = exceedsPlan(
      'allocation',
      group.actualCents,
      group.plannedCents,
    )
  }

  return {
    byGroup,
    plannedExpensesCents: plannedExpensesCents + plannedDebtCents,
    actualExpensesCents: actualExpensesCents + actualDebtCents,
    plannedIncomeCents,
    actualIncomeCents,
    plannedSavingsCents,
    actualSavingsCents,
    plannedSurplusCents,
    actualSurplusCents,
    perPersonFunMoneyCents,
    plannedFunMoneyCents: plannedSurplusCents,
    actualFunMoneyCents: groupTotal('allocation', 'actualCents'),
    endingBalanceCents: actualSurplusCents - plannedSurplusCents,
  }
}

export function parseMoneyToCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null
    const cents = Math.round((value + Number.EPSILON) * 100)
    return Number.isSafeInteger(cents) ? cents : null
  }

  const raw = String(value ?? '').trim()
  if (!raw) return null

  const isParenthesized = /^\(.*\)$/.test(raw)
  const normalized = raw.replace(/[(),$£€\s]/g, '').replace(/,/g, '')
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return null

  const sign = match[1] === '-' || isParenthesized ? -1 : 1
  const whole = Number(match[2])
  const fraction = Number((match[3] ?? '').padEnd(2, '0'))
  if (!Number.isSafeInteger(whole)) return null
  const cents = whole * 100 + fraction
  return Number.isSafeInteger(cents) ? sign * cents : null
}
