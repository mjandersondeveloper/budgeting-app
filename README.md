# Household Budget

A React + Vite household budgeting app. The local-first Phase 1 workflow remains
available in tests; the deployed app uses Firebase Authentication and Cloud
Firestore for a shared household budget.

## Features

- Overview of monthly income, expenses and debt, savings, surplus/deficit,
  category budgets, equal fun-money allocation, and ending balance.
- Activity entry with date, description, amount, category, and optional note.
- Monthly plans for the workbook's category groups, with a reusable budget
  template for months that do not have their own override; add categories to
  budget groups or rename categories while keeping existing activity and
  budgets attached. Copy the previous month’s plan into a new month without
  copying its activity.
- Car expenses include car insurance and a future-ready car-payment category.
  Former miscellaneous spending is split across food and dining, home and
  household, personal and lifestyle, travel, and pets. Debt is kept separate
  from car expenses, with a named fallback category for other debt payments.
- Existing local budgets and activity are migrated when loaded: duplicate car
  insurance amounts merge into Car, other insurance entries move into
  Healthcare, and custom categories from the former miscellaneous or insurance
  groups move into Personal & Lifestyle.
- Local CSV import of category budgets, plus CSV and JSON backup/exports.
- Responsive navigation and layouts for desktop, tablet, and phone.
- Dark appearance by default, with above-plan spending highlighted in red
  (income is not treated as overspending).

## Development

Requires Node.js 22+ and npm. Firebase Cloud Functions use the Node.js 22
runtime.

```sh
npm install
npm run dev
npm test
npm run lint
npm run build
```

The production build uses the GitHub Pages base path `/budgeting-app/`.

## Firebase setup

No Firebase project is included in this repository. Create a separate Firebase
project, add a web app, enable **Email/Password** in Authentication, and create
a Cloud Firestore database in `us-central1` (the Functions region). Do not
place service-account credentials in this browser app.

1. Copy `.env.example` to `.env` and fill in the web app configuration from
   Firebase Console → Project settings → Your apps.
2. Copy `.firebaserc.example` to `.firebaserc` and replace the project ID.
3. In Firebase Console, open **Authentication → Settings → Authorized
   domains**. Add `localhost` for local development and
   `mjandersondeveloper.github.io` for the deployed app if they are not already
   listed. Enter only the hostname—no `https://` and no `/budgeting-app/` path.
   The deployed app URL is
   `https://mjandersondeveloper.github.io/budgeting-app/`.

   API-key restrictions are optional hardening, not part of this required
   Authentication step. You can skip them while getting the app running; the
   Firebase web API key is public, and Firestore rules plus Authentication
   protect budget data.
4. Deploy the Firestore rules and callable Functions from the repository root:

   ```sh
   npx --yes firebase-tools@15.37.0 login
   npx --yes firebase-tools@15.37.0 deploy --only firestore:rules,functions
   ```

   Cloud Functions deployment requires the Firebase project to use the Blaze
   billing plan. No production Firebase resources or rules are changed by
   running the local build or tests.
5. In GitHub repository Settings → Pages, select **GitHub Actions** as the
   build and deployment source. Add the six `VITE_FIREBASE_*` values from
   `.env.example` under Settings → Secrets and variables → Actions → Variables.
   The workflow validates these values, runs the checks, and deploys `main` to
   Pages. These Firebase web configuration values identify the project and are
   public; never add a service-account key or other server credential to the
   client or GitHub Pages build.
6. Visit the deployed app, create an account with your own email, and verify
   it. Create the household, then create a one-time invitation from Settings.
   The other household member creates a separate account, verifies their email,
   and redeems the code. Codes are single-use, expire after 24 hours, and are
   rate-limited.

Email/password is used rather than a shared household password: Firebase Auth
handles password storage and recovery, each person has an independently
revocable identity, and Firestore rules—not a client-side screen—protect the
budget. Email addresses are used for account operations and are not displayed
as budget data.

## Shared data and security

- `users/{uid}` stores the signed-in user's household ID.
- `households/{householdId}/members/{uid}` is written only by callable
  Functions; each household is limited to two members.
- `households/{householdId}/budgetConfig/current` stores the reusable plan and
  category definitions.
- `households/{householdId}/monthlyBudgets/{yyyy-MM}` stores each month's
  category amounts.
- `households/{householdId}/activities/{activityId}` stores each activity
  separately so editing one activity does not replace the rest.
- Invitation records and join-attempt rate limits are server-only. Invitation
  codes are stored as hashes and are never readable through Firestore rules.
- Firestore rules deny access to unverified users and non-members. Client
  writes cannot create or change membership records.
- If Phase 1 local data is found after sign-in, the app asks what to do. It
  imports only into an empty household, atomically, and never silently merges
  or overwrites non-empty shared data. A single import is limited to 500
  Firestore writes; the local source is preserved as a backup.

## Tests and Firebase emulators

The regular test suite does not require Firebase credentials or emulators.
Security-rule tests use the Firestore Emulator and require a Java runtime
supported by the installed Firebase CLI:

```sh
npm run test:rules
```

Cloud Functions static checks and unit tests can be run with:

```sh
npm run lint:functions
npm run test:functions
```

Local CSV files are parsed in the browser. Do not commit the workbook, exported
budget data, `.env`, or `.firebaserc` to the repository.
