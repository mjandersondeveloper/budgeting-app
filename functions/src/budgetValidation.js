import { HttpsError } from 'firebase-functions/v2/https'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function validateBudgetData(data) {
  if (
    !isRecord(data) ||
    !isRecord(data.budgetTemplate) ||
    !isRecord(data.budgetsByMonth) ||
    !Array.isArray(data.activities) ||
    !Array.isArray(data.customCategories) ||
    !isRecord(data.categoryNameOverrides)
  ) {
    throw new HttpsError('invalid-argument', 'The selected budget backup is invalid.')
  }

  const monthEntries = Object.entries(data.budgetsByMonth)
  if (monthEntries.some(([month, amounts]) =>
    !/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month) ||
    !isRecord(amounts) ||
    Object.values(amounts).some((amount) =>
      !Number.isSafeInteger(amount) || amount < 0,
    ),
  )) {
    throw new HttpsError('invalid-argument', 'The selected backup has an invalid monthly budget.')
  }
  if (Object.values(data.budgetTemplate).some((amount) =>
    !Number.isSafeInteger(amount) || amount < 0,
  )) {
    throw new HttpsError('invalid-argument', 'The selected backup has an invalid budget template.')
  }
  if (data.customCategories.length > 200) {
    throw new HttpsError('invalid-argument', 'The selected backup has too many custom categories.')
  }

  const activityIds = new Set()
  for (const activity of data.activities) {
    if (
      !isRecord(activity) ||
      typeof activity.id !== 'string' ||
      !activity.id ||
      activity.id.includes('/') ||
      activityIds.has(activity.id) ||
      typeof activity.description !== 'string' ||
      !activity.description.trim() ||
      activity.description.length > 100 ||
      !Number.isSafeInteger(activity.amountCents) ||
      activity.amountCents <= 0 ||
      typeof activity.categoryId !== 'string' ||
      typeof activity.date !== 'string' ||
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(activity.date) ||
      (activity.note !== undefined && typeof activity.note !== 'string') ||
      (activity.note?.length ?? 0) > 300
    ) {
      throw new HttpsError('invalid-argument', 'The selected backup has an invalid activity.')
    }
    activityIds.add(activity.id)
  }

  const writeCount = 1 + monthEntries.length + data.activities.length
  if (writeCount > 500) {
    throw new HttpsError(
      'failed-precondition',
      'This backup contains too many records to import atomically. Export it for safekeeping and contact the app owner.',
    )
  }
}
