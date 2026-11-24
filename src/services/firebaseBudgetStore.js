import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getCurrentMonthKey } from '../domain/budget'
import { firebaseFunctions, firestore } from './firebase'

const CONFIG_DOCUMENT = 'current'
const CONFIG_FIELDS = [
  'budgetTemplate',
  'customCategories',
  'categoryNameOverrides',
]

export function hasBudgetData(data) {
  return Boolean(
    Object.keys(data.budgetTemplate ?? {}).length ||
    Object.keys(data.budgetsByMonth ?? {}).length ||
    data.activities?.length ||
    data.customCategories?.length ||
    Object.keys(data.categoryNameOverrides ?? {}).length,
  )
}

export function subscribeToHouseholdBudget(householdId, onData, onError) {
  if (!firestore) throw new Error('Firebase is not configured.')

  const householdPath = `households/${householdId}`
  let config
  let budgetsByMonth
  let activities
  let configLoaded = false
  let budgetsLoaded = false
  let activitiesLoaded = false
  let stopped = false

  function emit() {
    if (stopped || !configLoaded || !budgetsLoaded || !activitiesLoaded) return
    const data = {
      month: getCurrentMonthKey(),
      budgetTemplate: config.budgetTemplate ?? {},
      budgetsByMonth,
      activities,
      customCategories: config.customCategories ?? [],
      categoryNameOverrides: config.categoryNameOverrides ?? {},
      updatedAt: new Date().toISOString(),
    }
    onData(data, hasBudgetData(data))
  }

  const unsubscribe = [
    onSnapshot(
      doc(firestore, householdPath, 'budgetConfig', CONFIG_DOCUMENT),
      (snapshot) => {
        if (!snapshot.exists()) {
          onError(new Error('The household budget configuration is missing.'))
          return
        }
        config = snapshot.data()
        configLoaded = true
        emit()
      },
      onError,
    ),
    onSnapshot(
      collection(firestore, householdPath, 'monthlyBudgets'),
      (snapshot) => {
        budgetsByMonth = Object.fromEntries(
          snapshot.docs.map((monthDocument) => [
            monthDocument.id,
            monthDocument.data().amounts ?? {},
          ]),
        )
        budgetsLoaded = true
        emit()
      },
      onError,
    ),
    onSnapshot(
      collection(firestore, householdPath, 'activities'),
      (snapshot) => {
        activities = snapshot.docs.map((activityDocument) => {
          const activity = activityDocument.data()
          delete activity.updatedAt
          return activity
        })
        activitiesLoaded = true
        emit()
      },
      onError,
    ),
  ]

  return () => {
    stopped = true
    unsubscribe.forEach((stop) => stop())
  }
}

export async function loadHouseholdBudgetData(householdId) {
  if (!firestore) throw new Error('Firebase is not configured.')

  const householdPath = `households/${householdId}`
  const [configSnapshot, monthsSnapshot, activitiesSnapshot] = await Promise.all([
    getDoc(doc(firestore, householdPath, 'budgetConfig', CONFIG_DOCUMENT)),
    getDocs(collection(firestore, householdPath, 'monthlyBudgets')),
    getDocs(collection(firestore, householdPath, 'activities')),
  ])
  if (!configSnapshot.exists()) {
    throw new Error('The household budget configuration is missing.')
  }
  const config = configSnapshot.data()
  return {
    month: getCurrentMonthKey(),
    budgetTemplate: config.budgetTemplate ?? {},
    budgetsByMonth: Object.fromEntries(
      monthsSnapshot.docs.map((monthDocument) => [
        monthDocument.id,
        monthDocument.data().amounts ?? {},
      ]),
    ),
    activities: activitiesSnapshot.docs.map((activityDocument) => {
      const activity = activityDocument.data()
      delete activity.updatedAt
      return activity
    }),
    customCategories: config.customCategories ?? [],
    categoryNameOverrides: config.categoryNameOverrides ?? {},
    updatedAt: new Date().toISOString(),
  }
}

export async function saveHouseholdBudgetData(householdId, previousData, nextData) {
  if (!firestore) throw new Error('Firebase is not configured.')

  const householdPath = `households/${householdId}`
  const changedConfigFields = CONFIG_FIELDS.filter(
    (field) => !sameValue(previousData[field], nextData[field]),
  )
  const writes = []

  if (changedConfigFields.length) {
    writes.push(updateConfig(
      householdPath,
      previousData,
      nextData,
      changedConfigFields,
    ))
  }

  const monthKeys = new Set([
    ...Object.keys(previousData.budgetsByMonth ?? {}),
    ...Object.keys(nextData.budgetsByMonth ?? {}),
  ])
  for (const month of monthKeys) {
    const previousAmounts = previousData.budgetsByMonth?.[month] ?? {}
    const nextAmounts = nextData.budgetsByMonth?.[month] ?? {}
    if (!sameValue(previousAmounts, nextAmounts)) {
      writes.push(updateMonthBudgets(householdPath, month, previousAmounts, nextAmounts))
    }
  }

  const previousActivities = new Map(
    (previousData.activities ?? []).map((activity) => [activity.id, activity]),
  )
  const nextActivities = new Map(
    (nextData.activities ?? []).map((activity) => [activity.id, activity]),
  )
  for (const [id, activity] of nextActivities) {
    const previousActivity = previousActivities.get(id)
    if (!previousActivity || !sameValue(previousActivity, activity)) {
      writes.push(setDoc(
        doc(firestore, householdPath, 'activities', id),
        { ...activity, note: activity.note ?? '', updatedAt: serverTimestamp() },
      ))
    }
  }
  for (const id of previousActivities.keys()) {
    if (!nextActivities.has(id)) {
      writes.push(deleteDoc(doc(firestore, householdPath, 'activities', id)))
    }
  }

  const outcomes = await Promise.allSettled(writes)
  const failedWrite = outcomes.find((outcome) => outcome.status === 'rejected')
  if (failedWrite) throw failedWrite.reason
}

export async function importBudgetDataToEmptyHousehold(data) {
  if (!firebaseFunctions) throw new Error('Firebase is not configured.')
  const importBudget = httpsCallable(firebaseFunctions, 'importLocalBudgetData')
  const result = await importBudget({ budgetData: data })
  return result.data
}

async function updateConfig(householdPath, previousData, nextData, changedFields) {
  const configRef = doc(firestore, householdPath, 'budgetConfig', CONFIG_DOCUMENT)
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(configRef)
    if (!snapshot.exists()) {
      throw new Error('The household budget configuration is missing.')
    }
    const current = snapshot.data()
    const updates = { updatedAt: serverTimestamp() }
    for (const field of changedFields) {
      if (field === 'budgetTemplate' || field === 'categoryNameOverrides') {
        updates[field] = mergeMapChanges(
          current[field] ?? {},
          previousData[field] ?? {},
          nextData[field] ?? {},
        )
      } else {
        updates[field] = mergeCategoryChanges(
          current[field] ?? [],
          previousData[field] ?? [],
          nextData[field] ?? [],
        )
      }
    }
    transaction.update(configRef, updates)
  })
}

async function updateMonthBudgets(householdPath, month, previousAmounts, nextAmounts) {
  const monthRef = doc(firestore, householdPath, 'monthlyBudgets', month)
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(monthRef)
    const current = snapshot.exists() ? snapshot.data().amounts ?? {} : {}
    const amounts = mergeMapChanges(current, previousAmounts, nextAmounts)
    transaction.set(monthRef, { amounts, updatedAt: serverTimestamp() })
  })
}

function mergeMapChanges(current, previous, next) {
  const merged = { ...current }
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  for (const key of keys) {
    if (sameValue(previous[key], next[key])) continue
    if (Object.hasOwn(next, key)) {
      merged[key] = next[key]
    } else {
      delete merged[key]
    }
  }
  return merged
}

function mergeCategoryChanges(current, previous, next) {
  const currentById = new Map(current.map((category) => [category.id, category]))
  const previousById = new Map(previous.map((category) => [category.id, category]))
  const nextById = new Map(next.map((category) => [category.id, category]))

  for (const [id, category] of nextById) {
    if (!sameValue(previousById.get(id), category)) currentById.set(id, category)
  }
  for (const id of previousById.keys()) {
    if (!nextById.has(id)) currentById.delete(id)
  }
  return [...currentById.values()]
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
