import { readFileSync } from 'node:fs'
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  doc,
  deleteDoc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'

const projectId = 'demo-budgeting-app'
let testEnvironment

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
    },
  })
})

beforeEach(async () => {
  await testEnvironment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'households', 'andersons'), { name: 'The Andersons' })
    await setDoc(doc(db, 'households', 'andersons', 'members', 'member-1'), {
      uid: 'member-1',
      role: 'owner',
    })
    await setDoc(doc(db, 'households', 'andersons', 'budgetConfig', 'current'), {
      budgetTemplate: {},
      customCategories: [],
      categoryNameOverrides: {},
      updatedAt: new Date(),
    })
    await setDoc(doc(db, 'households', 'andersons', 'monthlyBudgets', '2026-01'), {
      amounts: { 'home:mortgage': 120000 },
      updatedAt: new Date(),
    })
  })
})

afterEach(async () => {
  await testEnvironment.clearFirestore()
})

afterAll(async () => {
  await testEnvironment.cleanup()
})

describe('Firestore household access rules', () => {
  it('lets a verified household member read shared budget data', async () => {
    const db = testEnvironment.authenticatedContext(
      'member-1',
      { email_verified: true },
    ).firestore()

    await assertSucceeds(getDoc(doc(db, 'households', 'andersons')))
    await assertSucceeds(getDoc(doc(
      db,
      'households',
      'andersons',
      'budgetConfig',
      'current',
    )))
    await assertSucceeds(getDoc(doc(
      db,
      'households',
      'andersons',
      'monthlyBudgets',
      '2026-01',
    )))
  })

  it('allows valid activity writes but rejects invalid amounts', async () => {
    const db = testEnvironment.authenticatedContext(
      'member-1',
      { email_verified: true },
    ).firestore()
    const validActivity = {
      id: 'activity-1',
      description: 'Groceries',
      amountCents: 5234,
      categoryId: 'food:groceries',
      date: '2026-01-12',
      note: '',
      updatedAt: serverTimestamp(),
    }

    await assertSucceeds(setDoc(
      doc(db, 'households', 'andersons', 'activities', 'activity-1'),
      validActivity,
    ))
    await assertFails(setDoc(
      doc(db, 'households', 'andersons', 'activities', 'activity-invalid'),
      { ...validActivity, id: 'activity-invalid', amountCents: -1 },
    ))
  })

  it('denies access to unverified, unauthenticated, and non-member users', async () => {
    const unverifiedDb = testEnvironment.authenticatedContext('member-1').firestore()
    const outsiderDb = testEnvironment.authenticatedContext(
      'outsider',
      { email_verified: true },
    ).firestore()
    const unauthenticatedDb = testEnvironment.unauthenticatedContext().firestore()
    const budgetRef = (db) => doc(
      db,
      'households',
      'andersons',
      'monthlyBudgets',
      '2026-01',
    )

    await assertFails(getDoc(budgetRef(unverifiedDb)))
    await assertFails(getDoc(budgetRef(outsiderDb)))
    await assertFails(getDoc(budgetRef(unauthenticatedDb)))
  })

  it('keeps household membership and user profiles server-managed', async () => {
    const db = testEnvironment.authenticatedContext(
      'member-1',
      { email_verified: true },
    ).firestore()

    await assertFails(setDoc(
      doc(db, 'households', 'andersons', 'members', 'member-2'),
      { uid: 'member-2', role: 'owner' },
    ))
    await assertFails(setDoc(doc(db, 'users', 'member-1'), { householdId: 'andersons' }))
    await assertFails(getDoc(doc(db, 'householdInvites', 'some-code')))
    await assertFails(getDoc(doc(db, 'inviteRateLimits', 'member-1')))
  })

  it('does not allow clients to create the server-owned budget configuration', async () => {
    const db = testEnvironment.authenticatedContext(
      'member-1',
      { email_verified: true },
    ).firestore()
    const configRef = doc(db, 'households', 'andersons', 'budgetConfig', 'current')

    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(
        context.firestore(),
        'households',
        'andersons',
        'budgetConfig',
        'current',
      ))
    })
    await assertFails(setDoc(configRef, {
      budgetTemplate: {},
      customCategories: [],
      categoryNameOverrides: {},
      updatedAt: serverTimestamp(),
    }))
  })
})
