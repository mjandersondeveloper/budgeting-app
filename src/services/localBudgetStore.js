import { categories, categoryGroups } from '../data/categories'

const STORAGE_KEY = 'household-budget-phase1-v1'
const categoryIds = new Set(categories.map((category) => category.id))
const categoryById = new Map(categories.map((category) => [category.id, category]))
const groupById = new Map(categoryGroups.map((group) => [group.id, group]))

export function createInitialBudgetData(month) {
  return {
    month,
    budgetTemplate: {},
    budgetsByMonth: {},
    activities: [],
    customCategories: [],
    categoryNameOverrides: {},
    updatedAt: new Date().toISOString(),
  }
}

export function loadBudgetData(month, storage = window.localStorage) {
  const serialized = storage.getItem(STORAGE_KEY)
  if (!serialized) return createInitialBudgetData(month)

  try {
    return {
      ...importBudgetBackup(serialized),
      month,
    }
  } catch (error) {
    throw new Error(
      `Saved budget data could not be read: ${error.message}`,
      { cause: error },
    )
  }
}

export function saveBudgetData(data, storage = window.localStorage) {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...data, updatedAt: new Date().toISOString() }),
    )
  } catch (error) {
    throw new Error(
      `Budget data could not be saved in this browser: ${error.message}`,
      { cause: error },
    )
  }
}

export function exportBudgetBackup(data) {
  return JSON.stringify(data, null, 2)
}

export function importBudgetBackup(serialized) {
  let data
  try {
    data = JSON.parse(serialized)
  } catch (error) {
    throw new Error('The backup file is not valid JSON.', { cause: error })
  }

  if (
    !data ||
    typeof data !== 'object' ||
    !Array.isArray(data.activities) ||
    !isRecord(data.budgetsByMonth) ||
    !isRecord(data.budgetTemplate)
  ) {
    throw new Error('The backup file does not have the expected budget format.')
  }

  const customCategories = data.customCategories ?? []
  const categoryNameOverrides = data.categoryNameOverrides ?? {}
  const validCategoryIds = validateCategories(
    customCategories,
    categoryNameOverrides,
  )

  for (const activity of data.activities) {
    if (
      !activity ||
      typeof activity.id !== 'string' ||
      typeof activity.description !== 'string' ||
      !validCategoryIds.has(activity.categoryId) ||
      !isValidMonthDay(activity.date) ||
      !Number.isSafeInteger(activity.amountCents) ||
      activity.amountCents <= 0 ||
      (activity.note !== undefined && typeof activity.note !== 'string')
    ) {
      throw new Error('The backup contains an invalid activity entry.')
    }
  }

  validateBudgets(data.budgetTemplate, validCategoryIds)
  for (const [month, budgets] of Object.entries(data.budgetsByMonth)) {
    if (!isValidMonthKey(month) || !isRecord(budgets)) {
      throw new Error('The backup contains an invalid monthly budget.')
    }
    validateBudgets(budgets, validCategoryIds)
  }

  return {
    month: isValidMonthKey(data.month) ? data.month : getMonthFallback(),
    budgetTemplate: data.budgetTemplate,
    budgetsByMonth: data.budgetsByMonth,
    activities: data.activities,
    customCategories,
    categoryNameOverrides,
    updatedAt: new Date().toISOString(),
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isValidMonthDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isValidMonthKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return false
  }
  return true
}

function validateBudgets(budgets, validCategoryIds) {
  for (const [categoryId, cents] of Object.entries(budgets)) {
    if (
      !validCategoryIds.has(categoryId) ||
      !Number.isSafeInteger(cents) ||
      cents < 0
    ) {
      throw new Error('The backup contains an invalid category budget.')
    }
  }
}

function validateCategories(customCategories, categoryNameOverrides) {
  if (!Array.isArray(customCategories) || !isRecord(categoryNameOverrides)) {
    throw new Error('The backup contains invalid category definitions.')
  }

  const validCategoryIds = new Set(categoryIds)
  const namesByGroup = new Map()
  const registerName = (groupId, name) => {
    const normalized = name.trim().toLowerCase()
    let names = namesByGroup.get(groupId)
    if (!names) {
      names = new Set()
      namesByGroup.set(groupId, names)
    }
    if (names.has(normalized)) {
      throw new Error('The backup contains duplicate category names in a group.')
    }
    names.add(normalized)
  }

  for (const [categoryId, name] of Object.entries(categoryNameOverrides)) {
    if (
      !categoryById.has(categoryId) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.trim().length > 60
    ) {
      throw new Error('The backup contains an invalid category name.')
    }
  }

  for (const category of categories) {
    registerName(
      category.groupId,
      categoryNameOverrides[category.id] ?? category.name,
    )
  }

  for (const category of customCategories) {
    const group = category && groupById.get(category.groupId)
    if (
      !category ||
      typeof category.id !== 'string' ||
      !/^custom-category-[a-zA-Z0-9-]{8,100}$/.test(category.id) ||
      validCategoryIds.has(category.id) ||
      !group ||
      group.type === 'allocation' ||
      category.type !== group.type ||
      typeof category.name !== 'string' ||
      !category.name.trim() ||
      category.name.trim().length > 60
    ) {
      throw new Error('The backup contains an invalid custom category.')
    }
    validCategoryIds.add(category.id)
    registerName(group.id, category.name)
  }

  return validCategoryIds
}

function getMonthFallback() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function getStorageKey() {
  return STORAGE_KEY
}
