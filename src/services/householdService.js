import { httpsCallable } from 'firebase/functions'
import { doc, onSnapshot } from 'firebase/firestore'
import { firebaseFunctions, firestore } from './firebase'

function callFunction(name, data) {
  if (!firebaseFunctions) {
    throw new Error('Firebase is not configured.')
  }
  return httpsCallable(firebaseFunctions, name)(data)
}

export async function createHousehold(name) {
  const result = await callFunction('createHousehold', { name })
  return result.data
}

export async function createHouseholdInvite() {
  const result = await callFunction('createHouseholdInvite', {})
  return result.data
}

export async function joinHouseholdWithInvite(code) {
  const result = await callFunction('joinHouseholdWithInvite', { code })
  return result.data
}

export function subscribeToUserProfile(uid, onProfile, onError) {
  if (!firestore) throw new Error('Firebase is not configured.')
  return onSnapshot(
    doc(firestore, 'users', uid),
    (snapshot) => onProfile(snapshot.exists() ? snapshot.data() : null),
    onError,
  )
}

export function subscribeToHousehold(householdId, onHousehold, onError) {
  if (!firestore) throw new Error('Firebase is not configured.')
  return onSnapshot(
    doc(firestore, 'households', householdId),
    (snapshot) => onHousehold(snapshot.exists() ? snapshot.data() : null),
    onError,
  )
}
