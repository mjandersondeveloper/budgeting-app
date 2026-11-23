import { categoryGroups as defaultCategoryGroups } from '../data/categories'
import { parseMoneyToCents } from '../domain/budget'

const normalizeLabel = (label) =>
  String(label ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()

function parseCsvRows(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        field += character
      }
      continue
    }

    if (character === '"' && field.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('The CSV file has an unfinished quoted field.')
  if (field.length || row.length) {
    row.push(field)
    if (row.some((cell) => cell.trim())) rows.push(row)
  }
  return rows
}

export function importBudgetCsv(text, categoryGroups = defaultCategoryGroups) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('The CSV file is empty.')
  }

  const rows = parseCsvRows(text.replace(/^\uFEFF/, ''))
  const headingToGroupId = new Map(
    categoryGroups.map((group) => [
      normalizeLabel(group.sheetHeading),
      group.id,
    ]),
  )
  const budgetByCategoryId = {}
  const unmatchedRows = []
  let activeGroupId = null
  let expectingInsuranceHeading = false

  const categoryLookup = new Map()
  for (const group of categoryGroups) {
    for (const category of group.categories) {
      const labels = [category.name, ...(category.aliases ?? [])]
      for (const label of labels) {
        categoryLookup.set(
          `${category.groupId}:${normalizeLabel(label)}`,
          category,
        )
      }
    }
  }

  for (const row of rows) {
    const label = String(row[0] ?? '').trim()
    const normalized = normalizeLabel(label)

    if (normalized === 'monthly') {
      expectingInsuranceHeading = true
      continue
    }

    if (expectingInsuranceHeading && normalized === 'insurance') {
      activeGroupId = headingToGroupId.get('insurance')
      expectingInsuranceHeading = false
      continue
    }
    expectingInsuranceHeading = false

    if (headingToGroupId.has(normalized)) {
      activeGroupId = headingToGroupId.get(normalized)
      continue
    }

    if (!activeGroupId || !label || /^total\b/i.test(label)) continue

    const category = categoryLookup.get(`${activeGroupId}:${normalized}`)
    if (!category) {
      unmatchedRows.push(label)
      continue
    }

    const amountCents = parseMoneyToCents(row[1])
    if (amountCents !== null) {
      budgetByCategoryId[category.id] = amountCents
    }
  }

  if (!Object.keys(budgetByCategoryId).length) {
    throw new Error(
      'No category budgets were found. Export the current budget worksheet as a CSV and try again.',
    )
  }

  return { budgetByCategoryId, unmatchedRows }
}
