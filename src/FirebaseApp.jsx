import { useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { doc, onSnapshot } from 'firebase/firestore'
import { App } from './App'
import { getCurrentMonthKey } from './domain/budget'
import { createInitialBudgetData, exportBudgetBackup, loadBudgetData } from './services/localBudgetStore'
import { firebaseAuth, firebaseConfigured, firestore, missingFirebaseConfig } from './services/firebase'
import { createHousehold, createHouseholdInvite, joinHouseholdWithInvite, subscribeToHousehold, subscribeToUserProfile } from './services/householdService'
import {
  hasBudgetData,
  importBudgetDataToEmptyHousehold,
  subscribeToHouseholdBudget,
} from './services/firebaseBudgetStore'
import './App.css'
import './dark-theme.css'
import './firebase.css'

const LEGACY_DECISION_PREFIX = 'household-budget-cloud-decision:'

function downloadLegacyBackup(data) {
  const blob = new Blob([exportBudgetBackup(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'household-budget-local-backup.json'
  link.click()
  URL.revokeObjectURL(url)
}

function authErrorMessage(error) {
  const messages = {
    'auth/email-already-in-use': 'An account already uses that email. Sign in instead.',
    'auth/invalid-credential': 'That email and password combination was not recognized.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
    'auth/password-mismatch': 'The passwords do not match.',
    'auth/too-many-requests': 'Too many attempts. Wait a little while and try again.',
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled in Firebase yet.',
    'auth/network-request-failed': 'Could not reach Firebase. Check your connection and try again.',
  }
  return messages[error.code] ?? error.message ?? 'The account request could not be completed.'
}

function callableErrorMessage(error) {
  const code = error.code?.replace('functions/', '')
  if (code === 'not-found') return 'That invitation code is invalid or has expired.'
  if (code === 'resource-exhausted') return error.message
  if (code === 'permission-denied') return error.message
  if (code === 'already-exists') return error.message
  if (code === 'failed-precondition') return error.message
  if (code === 'unauthenticated') return 'Sign in again before continuing.'
  return error.message ?? 'The household request could not be completed.'
}

function FirebaseApp() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(!firebaseConfigured)
  const [profileState, setProfileState] = useState({
    uid: null,
    profile: null,
    loading: true,
    error: '',
  })
  const [householdState, setHouseholdState] = useState({
    householdId: null,
    uid: null,
    household: null,
    member: null,
    error: '',
  })
  const [actionError, setActionError] = useState('')
  const [cloudState, setCloudState] = useState({
    householdId: null,
    loading: true,
    data: null,
    hasData: false,
    error: '',
  })
  const [invite, setInvite] = useState(null)
  const [inviteError, setInviteError] = useState('')
  const [busyAction, setBusyAction] = useState('')
  const [legacyState] = useState(() => {
    try {
      const data = loadBudgetData(getCurrentMonthKey())
      return { data, error: '', hasData: hasBudgetData(data) }
    } catch (error) {
      return {
        data: createInitialBudgetData(getCurrentMonthKey()),
        error: error.message,
        hasData: false,
      }
    }
  })
  const [legacyDecisionState, setLegacyDecisionState] = useState({
    householdId: null,
    decision: '',
  })
  const [legacyError, setLegacyError] = useState('')

  const profile = profileState.uid === user?.uid ? profileState.profile : null
  const profileReady = !user?.emailVerified ||
    (profileState.uid === user.uid && !profileState.loading)
  const profileError = profileState.uid === user?.uid ? profileState.error : ''
  const currentHouseholdState =
    householdState.householdId === profile?.householdId &&
    householdState.uid === user?.uid
    ? householdState
    : { household: null, member: null, error: '' }
  const household = currentHouseholdState.household
  const member = currentHouseholdState.member
  const householdError = actionError || profileError || currentHouseholdState.error
  const currentCloudState = cloudState.householdId === profile?.householdId
    ? cloudState
    : { loading: true, data: null, hasData: false, error: '' }
  const legacyDecision = legacyDecisionState.householdId === profile?.householdId
    ? legacyDecisionState.decision
    : ''

  useEffect(() => {
    if (!firebaseConfigured) return undefined
    return onAuthStateChanged(
      firebaseAuth,
      (nextUser) => {
        setUser(nextUser)
        setAuthReady(true)
      },
      (error) => {
        setActionError(error.message)
        setAuthReady(true)
      },
    )
  }, [])

  useEffect(() => {
    if (!user?.emailVerified) return undefined
    return subscribeToUserProfile(
      user.uid,
      (nextProfile) => {
        setProfileState({
          uid: user.uid,
          profile: nextProfile,
          loading: false,
          error: '',
        })
        if (nextProfile?.householdId) {
          try {
            setLegacyDecisionState({
              householdId: nextProfile.householdId,
              decision: window.localStorage.getItem(
                `${LEGACY_DECISION_PREFIX}${nextProfile.householdId}`,
              ) ?? '',
            })
          } catch (error) {
            setLegacyError(`This browser could not remember your migration choice: ${error.message}`)
          }
        } else {
          setLegacyDecisionState({ householdId: null, decision: '' })
        }
      },
      (error) => {
        setProfileState({
          uid: user.uid,
          profile: null,
          loading: false,
          error: `Your household profile could not be loaded: ${error.message}`,
        })
      },
    )
  }, [user])

  useEffect(() => {
    const householdId = profile?.householdId
    if (!householdId || !user) return undefined
    const unsubscribeHousehold = subscribeToHousehold(
      householdId,
      (nextHousehold) => setHouseholdState((state) => ({
        householdId,
        uid: user.uid,
        household: nextHousehold,
        member: state.householdId === householdId && state.uid === user.uid
          ? state.member
          : null,
        error: nextHousehold ? '' : 'The household record is missing.',
      })),
      (error) => setHouseholdState((state) => {
        const sameSession = state.householdId === householdId && state.uid === user.uid
        return {
          householdId,
          uid: user.uid,
          household: sameSession ? state.household : null,
          member: sameSession ? state.member : null,
          error: `The household could not be loaded: ${error.message}`,
        }
      }),
    )
    const unsubscribeMember = onSnapshot(
      doc(firestore, 'households', householdId, 'members', user.uid),
      (snapshot) => {
        const nextMember = snapshot.exists() ? snapshot.data() : null
        setHouseholdState((state) => ({
          householdId,
          uid: user.uid,
          household: state.householdId === householdId && state.uid === user.uid
            ? state.household
            : null,
          member: nextMember,
          error: nextMember ? '' : 'This account is no longer a member of the household.',
        }))
      },
      (error) => setHouseholdState((state) => {
        const sameSession = state.householdId === householdId && state.uid === user.uid
        return {
          householdId,
          uid: user.uid,
          household: sameSession ? state.household : null,
          member: sameSession ? state.member : null,
          error: `Your household access could not be checked: ${error.message}`,
        }
      }),
    )
    return () => {
      unsubscribeHousehold()
      unsubscribeMember()
    }
  }, [profile?.householdId, user])

  useEffect(() => {
    const householdId = profile?.householdId
    if (!householdId || !user?.emailVerified || !member) return undefined
    return subscribeToHouseholdBudget(
      householdId,
      (data, hasData) => setCloudState({
        householdId,
        loading: false,
        data,
        hasData,
        error: '',
      }),
      (error) => {
        setCloudState((state) => ({
          ...state,
          householdId,
          loading: false,
          error: `The shared budget could not be loaded: ${error.message}`,
        }))
      },
    )
  }, [profile?.householdId, user?.emailVerified, member])

  function rememberLegacyDecision(decision) {
    if (profile?.householdId) {
      try {
        window.localStorage.setItem(
          `${LEGACY_DECISION_PREFIX}${profile.householdId}`,
          decision,
        )
      } catch (error) {
        setLegacyError(`Your choice will apply only until this page is reloaded: ${error.message}`)
      }
    }
    setLegacyDecisionState({
      householdId: profile?.householdId ?? null,
      decision,
    })
  }

  async function handleSignOut() {
    try {
      await signOut(firebaseAuth)
      setInvite(null)
      setActionError('')
    } catch (error) {
      setActionError(authErrorMessage(error))
    }
  }

  async function handleCreateHousehold(name) {
    setBusyAction('create')
    setActionError('')
    try {
      await createHousehold(name)
    } catch (error) {
      setActionError(callableErrorMessage(error))
    } finally {
      setBusyAction('')
    }
  }

  async function handleJoinHousehold(code) {
    setBusyAction('join')
    setActionError('')
    try {
      await joinHouseholdWithInvite(code)
    } catch (error) {
      setActionError(callableErrorMessage(error))
    } finally {
      setBusyAction('')
    }
  }

  async function handleCreateInvite() {
    setBusyAction('invite')
    setInviteError('')
    setInvite(null)
    try {
      setInvite(await createHouseholdInvite())
    } catch (error) {
      setInviteError(callableErrorMessage(error))
    } finally {
      setBusyAction('')
    }
  }

  async function handleImportLegacyData() {
    setBusyAction('migration')
    setLegacyError('')
    try {
      await importBudgetDataToEmptyHousehold(legacyState.data)
      await rememberLegacyDecision('imported')
    } catch (error) {
      setLegacyError(callableErrorMessage(error))
    } finally {
      setBusyAction('')
    }
  }

  if (!firebaseConfigured) {
    return (
      <AccessFrame>
        <p className="eyebrow">FIREBASE SETUP</p>
        <h1>Connect your Firebase project</h1>
        <p className="auth-description">Add the web app configuration to a local <code>.env</code> file before using shared budgets.</p>
        <ol className="firebase-config-list">
          {missingFirebaseConfig.map((key) => <li key={key}><code>{key}</code></li>)}
        </ol>
        <p className="auth-help">Use the example in <code>.env.example</code>. These client configuration values identify your Firebase project; never add service-account credentials to the web app.</p>
      </AccessFrame>
    )
  }

  if (!authReady) return <LoadingScreen message="Checking account…" />
  if (!user) {
    return <AccountAccess
      onError={(error) => setActionError(error ? authErrorMessage(error) : '')}
      error={actionError}
    />
  }
  if (!user.emailVerified) {
    return (
      <VerificationScreen
        email={user.email}
        error={householdError}
        onResend={async () => {
          setActionError('')
          try {
            await sendEmailVerification(user)
          } catch (error) {
            setActionError(authErrorMessage(error))
          }
        }}
        onRefresh={async () => {
          setActionError('')
          try {
            await reload(user)
            await user.getIdToken(true)
            setUser(firebaseAuth.currentUser)
          } catch (error) {
            setActionError(authErrorMessage(error))
          }
        }}
        onSignOut={handleSignOut}
      />
    )
  }
  if (!profileReady) return <LoadingScreen message="Loading household access…" />
  if (householdError && !profile?.householdId) {
    return <ErrorScreen message={householdError} onRetry={() => window.location.reload()} onSignOut={handleSignOut} />
  }
  if (!profile?.householdId) {
    return (
      <HouseholdSetup
        busyAction={busyAction}
        error={householdError}
        onCreate={handleCreateHousehold}
        onJoin={handleJoinHousehold}
        onSignOut={handleSignOut}
      />
    )
  }
  if (householdError) {
    return <ErrorScreen message={householdError} onRetry={() => window.location.reload()} onSignOut={handleSignOut} />
  }
  if (!household || !member) return <LoadingScreen message="Connecting to your household…" />
  if (currentCloudState.error) {
    return <ErrorScreen message={currentCloudState.error} onRetry={() => window.location.reload()} onSignOut={handleSignOut} />
  }
  if (currentCloudState.loading || !currentCloudState.data) return <LoadingScreen message="Loading shared budget…" />

  if ((legacyState.hasData || legacyState.error) && !legacyDecision) {
    return (
      <LegacyDataDecision
        error={legacyError || legacyState.error}
        busy={busyAction === 'migration'}
        cloudHasData={currentCloudState.hasData}
        hasLegacyData={legacyState.hasData}
        onDownload={() => downloadLegacyBackup(legacyState.data)}
        onImport={handleImportLegacyData}
        onUseCloud={() => rememberLegacyDecision('use-cloud')}
      />
    )
  }

  return (
    <App
      key={profile.householdId}
      initialData={currentCloudState.data}
      shared
      householdId={profile.householdId}
      householdName={household.name ?? 'Household'}
      userEmail={user.email}
      canCreateInvite={member.role === 'owner'}
      invite={invite}
      inviteError={inviteError}
      isCreatingInvite={busyAction === 'invite'}
      onCreateInvite={handleCreateInvite}
      onClearInvite={() => setInvite(null)}
      onSignOut={handleSignOut}
    />
  )
}

function AccessFrame({ children }) {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="auth-brand-mark" aria-hidden="true">
          <svg className="auth-brand-icon" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 10.5 12 3l9 7.5M5.5 9v11h13V9M9 20v-6h6v6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </div>
        <p className="eyebrow">THE ANDERSONS</p>
        {children}
      </section>
    </main>
  )
}

function LoadingScreen({ message }) {
  return <main className="loading-screen" aria-live="polite">{message}</main>
}

function ErrorScreen({ message, onRetry, onSignOut }) {
  return (
    <AccessFrame>
      <h1>We couldn’t connect</h1>
      <p className="auth-description" role="alert">{message}</p>
      <div className="auth-actions">
        <button className="button button-primary" onClick={onRetry}>Try again</button>
        <button className="button button-secondary" onClick={onSignOut}>Sign out</button>
      </div>
    </AccessFrame>
  )
}

function AccountAccess({ error, onError }) {
  const [mode, setMode] = useState('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const registering = mode === 'sign-up'

  async function submit(event) {
    event.preventDefault()
    onError(null)
    setMessage('')
    if (registering && password !== confirmPassword) {
      onError({ code: 'auth/password-mismatch' })
      return
    }

    setBusy(true)
    try {
      if (registering) {
        const credential = await createUserWithEmailAndPassword(firebaseAuth, email.trim(), password)
        await sendEmailVerification(credential.user)
      } else {
        await signInWithEmailAndPassword(firebaseAuth, email.trim(), password)
      }
    } catch (requestError) {
      onError(requestError)
    } finally {
      setBusy(false)
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      onError({ code: 'auth/invalid-email', message: 'Enter your email address first.' })
      return
    }
    onError(null)
    setBusy(true)
    try {
      await sendPasswordResetEmail(firebaseAuth, email.trim())
      setMessage('If an account exists for that email, a password reset link has been sent.')
    } catch (requestError) {
      onError(requestError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccessFrame>
      <h1>{registering ? 'Create your account' : 'Sign in to your budget'}</h1>
      <p className="auth-description">Use a separate account for each household member. Your email is used for sign-in and account recovery.</p>
      <form className="auth-form" onSubmit={submit}>
        <label>
          <span>Email address</span>
          <input
            autoComplete="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            autoComplete={registering ? 'new-password' : 'current-password'}
            type="password"
            minLength="8"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {registering && (
          <label>
            <span>Confirm password</span>
            <input
              autoComplete="new-password"
              type="password"
              minLength="8"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
        )}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {!registering && (
        <button className="auth-text-button" onClick={resetPassword} disabled={busy}>Forgot password?</button>
      )}
      <p className="auth-switch">
        {registering ? 'Already have an account?' : 'New to the household budget?'}{' '}
        <button
          className="auth-text-button"
          onClick={() => {
            setMode(registering ? 'sign-in' : 'sign-up')
            setMessage('')
            onError(null)
          }}
        >
          {registering ? 'Sign in' : 'Create account'}
        </button>
      </p>
    </AccessFrame>
  )
}

function VerificationScreen({ email, error, onResend, onRefresh, onSignOut }) {
  return (
    <AccessFrame>
      <h1>Verify your email</h1>
      <p className="auth-description">We sent a verification link to <strong>{email}</strong>. Verify it, then return here to continue.</p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <div className="auth-actions auth-actions-stack">
        <button className="button button-primary" onClick={onRefresh}>I’ve verified my email</button>
        <button className="button button-secondary" onClick={onResend}>Resend verification email</button>
        <button className="auth-text-button" onClick={onSignOut}>Sign out</button>
      </div>
    </AccessFrame>
  )
}

function HouseholdSetup({ busyAction, error, onCreate, onJoin, onSignOut }) {
  const [name, setName] = useState('The Andersons')
  const [code, setCode] = useState('')
  const busy = Boolean(busyAction)

  return (
    <AccessFrame>
      <h1>Connect your household</h1>
      <p className="auth-description">Create the shared budget once, then invite the other household member with a one-time code.</p>
      <form className="auth-form" onSubmit={(event) => {
        event.preventDefault()
        onCreate(name)
      }}>
        <label>
          <span>Household name</span>
          <input maxLength="60" required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button className="button button-primary" type="submit" disabled={busy}>
          {busyAction === 'create' ? 'Creating…' : 'Create household'}
        </button>
      </form>
      <div className="auth-divider"><span>or join an existing household</span></div>
      <form className="auth-form" onSubmit={(event) => {
        event.preventDefault()
        onJoin(code)
      }}>
        <label>
          <span>One-time invitation code</span>
          <input
            autoComplete="off"
            maxLength="16"
            required
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </label>
        <button className="button button-secondary" type="submit" disabled={busy}>
          {busyAction === 'join' ? 'Joining…' : 'Join household'}
        </button>
      </form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-text-button auth-signout" onClick={onSignOut}>Sign out</button>
    </AccessFrame>
  )
}

function LegacyDataDecision({
  cloudHasData,
  hasLegacyData,
  busy,
  error,
  onDownload,
  onImport,
  onUseCloud,
}) {
  return (
    <AccessFrame>
      <p className="eyebrow">LOCAL DATA FOUND</p>
      <h1>
        {cloudHasData
          ? 'Choose which budget to use'
          : hasLegacyData ? 'Move your existing budget?' : 'Could not read older data'}
      </h1>
      <p className="auth-description">
        {!hasLegacyData
          ? 'The previous local budget could not be read. The shared budget will not be overwritten. You can continue with a new shared budget.'
          : cloudHasData
          ? 'This browser has an older local budget and the household already has shared data. They will not be merged automatically.'
          : 'This browser has a local budget from Phase 1. You can import it once into the empty shared household.'}
      </p>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {cloudHasData ? (
        <div className="auth-actions auth-actions-stack">
          {hasLegacyData && <button className="button button-secondary" onClick={onDownload}>Download old local backup</button>}
          <button className="button button-primary" onClick={onUseCloud}>Continue with shared budget</button>
        </div>
      ) : hasLegacyData ? (
        <div className="auth-actions auth-actions-stack">
          <button className="button button-primary" onClick={onImport} disabled={busy}>
            {busy ? 'Importing safely…' : 'Copy local data to shared budget'}
          </button>
          <button className="button button-secondary" onClick={onDownload}>Download local backup first</button>
          <button className="auth-text-button" onClick={onUseCloud}>Start with an empty shared budget</button>
        </div>
      ) : (
        <button className="button button-primary" onClick={onUseCloud}>Continue with an empty shared budget</button>
      )}
    </AccessFrame>
  )
}

export default FirebaseApp
