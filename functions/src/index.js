import { createHash, randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { validateBudgetData } from './budgetValidation.js'

initializeApp()

const db = getFirestore()
const REGION = 'us-central1'
const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const MAX_JOIN_ATTEMPTS = 8
const MAX_HOUSEHOLD_MEMBERS = 2

function requireVerifiedUser(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in to continue.')
  }
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Verify your email address to continue.')
  }
  return request.auth.uid
}

function normalizeHouseholdName(value) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'Enter a household name.')
  }
  const name = value.trim()
  if (!name || name.length > 60) {
    throw new HttpsError('invalid-argument', 'Household names must be 1 to 60 characters.')
  }
  return name
}

function normalizeInviteCode(value) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'Enter an invitation code.')
  }
  const code = value.trim().toUpperCase()
  if (!/^[A-F0-9]{16}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'That invitation code is not valid.')
  }
  return code
}

function hashInviteCode(code) {
  return createHash('sha256').update(code).digest('hex')
}

export const createHousehold = onCall({ region: REGION }, async (request) => {
  const uid = requireVerifiedUser(request)
  const name = normalizeHouseholdName(request.data?.name)
  const householdRef = db.collection('households').doc()
  const profileRef = db.collection('users').doc(uid)

  await db.runTransaction(async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef)
    if (profileSnapshot.data()?.householdId) {
      throw new HttpsError('already-exists', 'This account already belongs to a household.')
    }

    transaction.create(householdRef, {
      name,
      createdAt: FieldValue.serverTimestamp(),
    })
    transaction.create(householdRef.collection('members').doc(uid), {
      uid,
      role: 'owner',
      joinedAt: FieldValue.serverTimestamp(),
    })
    transaction.create(householdRef.collection('budgetConfig').doc('current'), {
      budgetTemplate: {},
      customCategories: [],
      categoryNameOverrides: {},
      updatedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(profileRef, {
      householdId: householdRef.id,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
  })

  return { householdId: householdRef.id }
})

export const createHouseholdInvite = onCall({ region: REGION }, async (request) => {
  const uid = requireVerifiedUser(request)
  const profileRef = db.collection('users').doc(uid)
  const profileSnapshot = await profileRef.get()
  const householdId = profileSnapshot.data()?.householdId
  if (!householdId) {
    throw new HttpsError('failed-precondition', 'Create or join a household first.')
  }

  const householdRef = db.collection('households').doc(householdId)
  const memberRef = householdRef.collection('members').doc(uid)
  const membersRef = householdRef.collection('members')
  const [memberSnapshot, membersSnapshot] = await Promise.all([
    memberRef.get(),
    membersRef.get(),
  ])
  if (memberSnapshot.data()?.role !== 'owner') {
    throw new HttpsError('permission-denied', 'Only the household owner can invite a member.')
  }
  if (membersSnapshot.size >= MAX_HOUSEHOLD_MEMBERS) {
    throw new HttpsError('failed-precondition', 'This household already has two members.')
  }

  const code = randomBytes(8).toString('hex').toUpperCase()
  const inviteRef = db.collection('householdInvites').doc(hashInviteCode(code))
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITE_LIFETIME_MS)
  await inviteRef.create({
    householdId,
    createdByUid: uid,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
  })

  return { code, expiresAt: expiresAt.toDate().toISOString() }
})

export const importLocalBudgetData = onCall({ region: REGION }, async (request) => {
  const uid = requireVerifiedUser(request)
  const data = request.data?.budgetData
  validateBudgetData(data)

  const profileRef = db.collection('users').doc(uid)
  const profileSnapshot = await profileRef.get()
  const householdId = profileSnapshot.data()?.householdId
  if (!householdId) {
    throw new HttpsError('failed-precondition', 'Create or join a household first.')
  }

  const householdRef = db.collection('households').doc(householdId)
  const memberRef = householdRef.collection('members').doc(uid)
  const configRef = householdRef.collection('budgetConfig').doc('current')
  const monthsRef = householdRef.collection('monthlyBudgets')
  const activitiesRef = householdRef.collection('activities')

  await db.runTransaction(async (transaction) => {
    const [memberSnapshot, configSnapshot, monthsSnapshot, activitiesSnapshot] =
      await Promise.all([
        transaction.get(memberRef),
        transaction.get(configRef),
        transaction.get(monthsRef),
        transaction.get(activitiesRef),
      ])
    if (!memberSnapshot.exists || !configSnapshot.exists) {
      throw new HttpsError('permission-denied', 'You are not a member of this household.')
    }

    const config = configSnapshot.data()
    if (
      monthsSnapshot.size ||
      activitiesSnapshot.size ||
      Object.keys(config.budgetTemplate ?? {}).length ||
      config.customCategories?.length ||
      Object.keys(config.categoryNameOverrides ?? {}).length
    ) {
      throw new HttpsError('already-exists', 'The shared budget is no longer empty. Nothing was imported.')
    }

    transaction.update(configRef, {
      budgetTemplate: data.budgetTemplate,
      customCategories: data.customCategories,
      categoryNameOverrides: data.categoryNameOverrides,
      updatedAt: FieldValue.serverTimestamp(),
    })
    for (const [month, amounts] of Object.entries(data.budgetsByMonth)) {
      transaction.create(monthsRef.doc(month), {
        amounts,
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    for (const activity of data.activities) {
      transaction.create(activitiesRef.doc(activity.id), {
        id: activity.id,
        description: activity.description.trim(),
        amountCents: activity.amountCents,
        categoryId: activity.categoryId,
        date: activity.date,
        note: activity.note ?? '',
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
  })

  return { importedActivityCount: data.activities.length }
})

export const joinHouseholdWithInvite = onCall({ region: REGION }, async (request) => {
  const uid = requireVerifiedUser(request)
  const code = normalizeInviteCode(request.data?.code)
  const inviteHash = hashInviteCode(code)
  const profileRef = db.collection('users').doc(uid)
  const inviteRef = db.collection('householdInvites').doc(inviteHash)
  const rateLimitRef = db.collection('inviteRateLimits').doc(uid)

  await db.runTransaction(async (transaction) => {
    const rateLimitSnapshot = await transaction.get(rateLimitRef)
    const now = Date.now()
    const lastWindowStart = rateLimitSnapshot.data()?.windowStartedAt?.toMillis?.() ?? 0
    const attempts = now - lastWindowStart >= RATE_LIMIT_WINDOW_MS
      ? 1
      : (rateLimitSnapshot.data()?.attempts ?? 0) + 1
    if (attempts > MAX_JOIN_ATTEMPTS) {
      throw new HttpsError(
        'resource-exhausted',
        'Too many invitation attempts. Wait 15 minutes and try again.',
      )
    }
    transaction.set(rateLimitRef, {
      attempts,
      windowStartedAt: Timestamp.fromMillis(
        attempts === 1 ? now : lastWindowStart,
      ),
    })
  })

  await db.runTransaction(async (transaction) => {
    const inviteSnapshot = await transaction.get(inviteRef)
    if (!inviteSnapshot.exists) {
      throw new HttpsError('not-found', 'That invitation code is invalid or has expired.')
    }

    const invite = inviteSnapshot.data()
    const householdRef = db.collection('households').doc(invite.householdId)
    const memberRef = householdRef.collection('members').doc(uid)
    const membersQuery = householdRef.collection('members')
    const [profileSnapshot, memberSnapshot, membersSnapshot] = await Promise.all([
      transaction.get(profileRef),
      transaction.get(memberRef),
      transaction.get(membersQuery),
    ])

    if (profileSnapshot.data()?.householdId || memberSnapshot.exists) {
      throw new HttpsError('already-exists', 'This account already belongs to a household.')
    }
    if (invite.expiresAt.toMillis() <= Date.now()) {
      throw new HttpsError('not-found', 'That invitation code is invalid or has expired.')
    }
    if (membersSnapshot.size >= MAX_HOUSEHOLD_MEMBERS) {
      throw new HttpsError('failed-precondition', 'This household already has two members.')
    }
    if (!invite.householdId) {
      throw new HttpsError('failed-precondition', 'That invitation is no longer available.')
    }

    transaction.create(memberRef, {
      uid,
      role: 'member',
      joinedAt: FieldValue.serverTimestamp(),
    })
    transaction.set(profileRef, {
      householdId: invite.householdId,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    transaction.delete(inviteRef)
  })

  return { joined: true }
})
