import { useEffect, useMemo, useRef, useState } from 'react'
import { buildCategoryGroups } from './data/categories'
import {
  formatMoney,
  getCurrentMonthKey,
  getMonthLabel,
  getPreviousMonthKey,
  parseMoneyToCents,
  summarizeBudget,
} from './domain/budget'
import { importBudgetCsv } from './services/csvImport'
import { serializeCsv } from './services/csvExport'
import {
  createInitialBudgetData,
  exportBudgetBackup,
  importBudgetBackup,
  loadBudgetData,
  saveBudgetData,
} from './services/localBudgetStore'
import { loadHouseholdBudgetData, saveHouseholdBudgetData } from './services/firebaseBudgetStore'
import './App.css'
import './dark-theme.css'

const navigation = [
  { id: 'overview', label: 'Overview', icon: '◫' },
  { id: 'activity', label: 'Activity', icon: '↗' },
  { id: 'budgets', label: 'Budgets', icon: '$' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]
const EMPTY_BUDGETS = Object.freeze({})
const EMPTY_ACTIVITIES = Object.freeze([])

function createId() {
  return globalThis.crypto?.randomUUID?.() ??
    `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function downloadFile(filename, contents, type) {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function App({
  initialData = null,
  shared = false,
  householdId = '',
  householdName = 'Household',
  userEmail = '',
  canCreateInvite = false,
  invite = null,
  inviteError = '',
  isCreatingInvite = false,
  onCreateInvite = () => {},
  onClearInvite = () => {},
  onSignOut = () => {},
}) {
  const [initialBudgetState] = useState(() => {
    if (shared) return { data: initialData, error: '' }
    const month = getCurrentMonthKey()
    try {
      return { data: loadBudgetData(month), error: '' }
    } catch (loadError) {
      return {
        data: createInitialBudgetData(month),
        error: loadError.message,
      }
    }
  })
  const [data, setData] = useState(initialBudgetState.data)
  const dataRef = useRef(initialBudgetState.data)
  const pendingSavesRef = useRef(0)
  const saveQueueRef = useRef(Promise.resolve())
  const [isSaving, setIsSaving] = useState(false)
  const [activePage, setActivePage] = useState('overview')
  const [editingActivity, setEditingActivity] = useState(null)
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [categoryFormGroupId, setCategoryFormGroupId] = useState(null)
  const [budgetFormRevision, setBudgetFormRevision] = useState(0)
  const [error, setError] = useState(initialBudgetState.error)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!shared || !initialData) return
    const nextData = {
      ...initialData,
      month: dataRef.current?.month ?? initialData.month,
    }
    dataRef.current = nextData
    setData(nextData)
  }, [initialData, shared])

  const month = data?.month ?? getCurrentMonthKey()
  const budgets =
    data?.budgetsByMonth?.[month] ?? data?.budgetTemplate ?? EMPTY_BUDGETS
  const activities = data?.activities ?? EMPTY_ACTIVITIES
  const groups = useMemo(
    () => buildCategoryGroups(
      data?.customCategories ?? [],
      data?.categoryNameOverrides ?? {},
    ),
    [data?.customCategories, data?.categoryNameOverrides],
  )
  const categories = useMemo(
    () => groups.flatMap((group) => group.categories),
    [groups],
  )
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((category) => [category.id, category])),
    [categories],
  )

  const monthActivities = useMemo(
    () => activities.filter((activity) => activity.date?.slice(0, 7) === month),
    [activities, month],
  )

  const summary = useMemo(
    () => summarizeBudget({ groups, budgets, activities: monthActivities }),
    [groups, budgets, monthActivities],
  )

  function persist(nextData) {
    if (shared) {
      const previousData = dataRef.current
      dataRef.current = nextData
      setData(nextData)
      setError('')
      setNotice('')
      pendingSavesRef.current += 1
      setIsSaving(true)

      const saveOperation = saveQueueRef.current.then(() =>
        saveHouseholdBudgetData(householdId, previousData, nextData),
      )
      saveQueueRef.current = saveOperation.catch(() => undefined)
      saveOperation.then(
        () => {
          pendingSavesRef.current -= 1
          if (pendingSavesRef.current === 0) setIsSaving(false)
        },
        async (saveError) => {
          pendingSavesRef.current -= 1
          if (pendingSavesRef.current === 0) setIsSaving(false)
          setNotice('')
          try {
            const refreshed = await loadHouseholdBudgetData(householdId)
            const currentMonth = dataRef.current?.month ?? refreshed.month
            const latestData = { ...refreshed, month: currentMonth }
            dataRef.current = latestData
            setData(latestData)
            setError(`Changes could not be saved to the shared budget: ${saveError.message}`)
          } catch (refreshError) {
            setError(
              `Changes could not be saved: ${saveError.message}. The latest shared data could not be reloaded: ${refreshError.message}`,
            )
          }
        },
      )
      return true
    }

    try {
      saveBudgetData(nextData)
      dataRef.current = nextData
      setData(nextData)
      setError('')
      return true
    } catch (saveError) {
      setError(saveError.message)
      return false
    }
  }

  function changeMonth(nextMonth) {
    if (!/^\d{4}-\d{2}$/.test(nextMonth)) return
    persist({ ...data, month: nextMonth })
    setNotice('')
  }

  function saveActivity(formValues) {
    const amountCents = parseMoneyToCents(formValues.amount)
    const category = categoryById[formValues.categoryId]
    if (!formValues.description.trim()) {
      setError('Enter a description for this activity.')
      return false
    }
    if (amountCents === null || amountCents <= 0) {
      setError('Enter an amount greater than zero with no more than two decimal places.')
      return false
    }
    if (!category || !formValues.date) {
      setError('Choose a category and date.')
      return false
    }

    const activity = {
      id: editingActivity?.id ?? createId(),
      description: formValues.description.trim(),
      amountCents,
      categoryId: category.id,
      date: formValues.date,
      note: formValues.note.trim(),
    }
    const nextActivities = editingActivity
      ? activities.map((item) => item.id === activity.id ? activity : item)
      : [...activities, activity]

    if (!persist({ ...data, activities: nextActivities })) return false
    setEditingActivity(null)
    setShowActivityForm(false)
    setNotice(editingActivity ? 'Activity updated.' : 'Activity added.')
    return true
  }

  function deleteActivity(activity) {
    if (!window.confirm(`Delete “${activity.description}”? This cannot be undone.`)) {
      return
    }
    if (persist({
      ...data,
      activities: activities.filter((item) => item.id !== activity.id),
    })) {
      setNotice('Activity deleted.')
    }
  }

  function saveBudgets(event) {
    event.preventDefault()
    const nextMonthBudgets = {}
    const formData = new FormData(event.currentTarget)

    for (const category of categories) {
      if (category.type === 'allocation') continue
      const cents = parseMoneyToCents(formData.get(category.id))
      if (cents === null || cents < 0) {
        setError(`Enter a valid non-negative budget for ${category.name}.`)
        return
      }
      nextMonthBudgets[category.id] = cents
    }

    const nextData = {
      ...data,
      budgetTemplate: nextMonthBudgets,
      budgetsByMonth: {
        ...data.budgetsByMonth,
        [month]: nextMonthBudgets,
      },
    }
    if (persist(nextData)) setNotice('Monthly budgets saved.')
  }

  function copyPreviousMonthBudget() {
    const previousMonth = getPreviousMonthKey(month)
    const previousMonthBudgets =
      data.budgetsByMonth[previousMonth] ?? data.budgetTemplate ?? EMPTY_BUDGETS
    if (!Object.keys(previousMonthBudgets).length) {
      setError(`There is no saved budget plan for ${getMonthLabel(previousMonth)} to copy.`)
      return
    }

    if (
      data.budgetsByMonth[month] &&
      !window.confirm(
        `Replace ${getMonthLabel(month)}'s plan with ${getMonthLabel(previousMonth)}'s plan?`,
      )
    ) {
      return
    }

    if (persist({
      ...data,
      budgetsByMonth: {
        ...data.budgetsByMonth,
        [month]: { ...previousMonthBudgets },
      },
    })) {
      setBudgetFormRevision((revision) => revision + 1)
      setNotice(
        `Copied ${getMonthLabel(previousMonth)}'s plan to ${getMonthLabel(month)}.`,
      )
    }
  }

  function openCategoryForm(groupId, category = null) {
    setCategoryFormGroupId(groupId)
    setEditingCategory(category)
    setError('')
  }

  function saveCategory({ name }) {
    const trimmedName = name.trim()
    const group = groups.find((item) => item.id === categoryFormGroupId)
    if (!trimmedName || trimmedName.length > 60) {
      setError('Enter a category name between 1 and 60 characters.')
      return false
    }
    if (!group || group.type === 'allocation') {
      setError('Choose a group that supports custom categories.')
      return false
    }
    if (
      group.categories.some((category) =>
        category.id !== editingCategory?.id &&
        category.name.trim().toLowerCase() === trimmedName.toLowerCase(),
      )
    ) {
      setError(`A category named “${trimmedName}” already exists in ${group.name}.`)
      return false
    }

    let nextData
    if (editingCategory) {
      const customCategory = data.customCategories.some(
        (category) => category.id === editingCategory.id,
      )
      nextData = customCategory
        ? {
            ...data,
            customCategories: data.customCategories.map((category) =>
              category.id === editingCategory.id
                ? { ...category, name: trimmedName }
                : category,
            ),
          }
        : {
            ...data,
            categoryNameOverrides: {
              ...data.categoryNameOverrides,
              [editingCategory.id]: trimmedName,
            },
          }
    } else {
      nextData = {
        ...data,
        customCategories: [
          ...data.customCategories,
          {
            id: `custom-category-${createId()}`,
            groupId: group.id,
            name: trimmedName,
            type: group.type,
          },
        ],
      }
    }

    if (!persist(nextData)) return false
    setEditingCategory(null)
    setCategoryFormGroupId(null)
    setNotice(editingCategory ? 'Category updated.' : 'Category added.')
    return true
  }

  async function importBudgetFile(event) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const imported = importBudgetCsv(await file.text(), groups)
      const nextMonthBudgets = {
        ...budgets,
        ...imported.budgetByCategoryId,
      }
      if (persist({
        ...data,
        budgetTemplate: nextMonthBudgets,
        budgetsByMonth: {
          ...data.budgetsByMonth,
          [month]: nextMonthBudgets,
        },
      })) {
        const unmatched = imported.unmatchedRows.length
        setNotice(
          `Imported ${Object.keys(imported.budgetByCategoryId).length} category budgets for ${getMonthLabel(month)}${unmatched ? `; ${unmatched} unrecognized row${unmatched === 1 ? '' : 's'} were skipped.` : '.'}`,
        )
      }
    } catch (importError) {
      setError(importError.message)
    } finally {
      event.target.value = ''
    }
  }

  async function restoreBackupFile(event) {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const restored = importBudgetBackup(await file.text())
      const prompt = shared
        ? 'Replace the shared household budget and activity with the selected backup? This affects both members.'
        : 'Replace this browser’s budget and activity with the selected backup?'
      if (!window.confirm(prompt)) {
        return
      }
      if (persist(restored)) {
        setNotice(shared ? 'Shared budget backup restored.' : 'Budget backup restored in this browser.')
      }
    } catch (restoreError) {
      setError(restoreError.message)
    } finally {
      event.target.value = ''
    }
  }

  function exportActivityCsv() {
    const rows = [
      ['Date', 'Description', 'Category Group', 'Category', 'Type', 'Amount', 'Note'],
      ...activities.map((activity) => {
        const category = categoryById[activity.categoryId]
        const group = groups.find((item) => item.id === category?.groupId)
        return [
          activity.date,
          activity.description,
          group?.name ?? '',
          category?.name ?? '',
          category?.type ?? '',
          (activity.amountCents / 100).toFixed(2),
          activity.note,
        ]
      }),
    ]
    downloadFile(
      'budget-activity.csv',
      serializeCsv(rows),
      'text/csv;charset=utf-8',
    )
  }

  function exportBudgetCsv() {
    const rows = [['Month', 'Category Group', 'Category', 'Type', 'Planned Amount']]
    for (const group of groups) {
      for (const category of group.categories) {
        rows.push([
          month,
          group.name,
          category.name,
          category.type,
          ((budgets[category.id] ?? 0) / 100).toFixed(2),
        ])
      }
    }
    downloadFile(
      `budget-${month}.csv`,
      serializeCsv(rows),
      'text/csv;charset=utf-8',
    )
  }

  function clearSelectedMonthActivity() {
    const activityCount = monthActivities.length
    if (activityCount === 0) return

    const monthLabel = getMonthLabel(month)
    const entryLabel = activityCount === 1 ? 'entry' : 'entries'
    const prompt = `Delete ${activityCount} activity ${entryLabel} for ${monthLabel}? This removes income, expenses, and savings for this month only. The monthly plan and other months' activity will remain. This cannot be undone.`
    if (!window.confirm(prompt)) return

    const nextActivities = activities.filter(
      (activity) => activity.date?.slice(0, 7) !== month,
    )
    if (persist({ ...data, activities: nextActivities })) {
      setNotice(
        `Cleared ${activityCount} activity ${entryLabel} for ${monthLabel}. The monthly plan and other months were kept.`,
      )
    }
  }

  if (!data) {
    return <main className="loading-screen" aria-live="polite">Loading your budget…</main>
  }

  const sortedActivities = [...monthActivities].sort((a, b) =>
    b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setActivePage('overview')}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <path d="M5 13.5 16 5l11 8.5v13H5z" />
              <path d="M12 26.5v-8h8v8M10 13h12" />
            </svg>
          </span>
          <span>
            <strong>The Andersons</strong>
            <small>HOUSEHOLD BUDGET</small>
          </span>
        </a>

        <div className="sidebar-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              className={`nav-item ${activePage === item.id ? 'active' : ''}`}
              key={item.id}
              onClick={() => {
                setActivePage(item.id)
                setNotice('')
              }}
              aria-current={activePage === item.id ? 'page' : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id === 'activity' && monthActivities.length > 0 && (
                <span className="nav-count">{monthActivities.length}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-card">
            <span className={`local-indicator${shared ? ' cloud-indicator' : ''}`} />
            <div>
              <strong>{shared ? 'Shared household' : 'On this device'}</strong>
              <p>{shared ? (isSaving ? 'Syncing changes…' : 'Live sync is on') : 'Syncing arrives in Phase 2'}</p>
            </div>
          </div>
          <p className="sidebar-footnote">
            {shared ? 'Changes are saved to the household cloud.' : 'Saved only in this browser’s storage.'}
          </p>
        </div>
      </aside>

      <main className="main-pane">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{shared ? householdName : 'Household'}</span>
            <span aria-hidden="true">/</span>
            <strong>{navigation.find((item) => item.id === activePage)?.label}</strong>
          </div>
          <div className="topbar-actions">
            <label className="month-picker">
              <span className="sr-only">Budget month</span>
              <input
                type="month"
                value={month}
                onChange={(event) => changeMonth(event.target.value)}
              />
            </label>
            {activePage !== 'activity' && (
              <button
                className="button button-primary top-add"
                onClick={() => {
                  setEditingActivity(null)
                  setShowActivityForm(true)
                  setError('')
                }}
              >
                <span className="add-activity-icon" aria-hidden="true" />
                <span>Add activity</span>
              </button>
            )}
          </div>
        </header>

        <div className="page-content">
          <div className="phase-banner" role="status">
            <span className="phase-badge">{shared ? 'SHARED' : 'PHASE 1'}</span>
            <span>
              {shared
                ? (isSaving ? 'Saving changes securely to the shared household…' : 'Your budget syncs live across household devices.')
                : 'This browser only. Live sharing between devices is planned for Phase 2.'}
            </span>
          </div>

          {(error || notice) && !categoryFormGroupId && (
            <div className={`message ${error ? 'message-error' : 'message-success'}`} role={error ? 'alert' : 'status'}>
              <span>{error || notice}</span>
              <button
                className="message-dismiss"
                aria-label="Dismiss message"
                onClick={() => {
                  setError('')
                  setNotice('')
                }}
              >
                ×
              </button>
            </div>
          )}

          {activePage === 'overview' && (
            <OverviewPage
              month={month}
              summary={summary}
              groups={summary.byGroup}
              categoryById={categoryById}
              activities={sortedActivities}
              onOpenBudgets={() => setActivePage('budgets')}
              onOpenActivity={(activity) => {
                setEditingActivity(activity)
                setShowActivityForm(true)
              }}
            />
          )}

          {activePage === 'activity' && (
            <ActivityPage
              month={month}
              activities={sortedActivities}
              groups={groups}
              categoryById={categoryById}
              onEdit={(activity) => {
                setEditingActivity(activity)
                setShowActivityForm(true)
                setError('')
              }}
              onDelete={deleteActivity}
              onAdd={() => {
                setEditingActivity(null)
                setShowActivityForm(true)
              }}
            />
          )}

          {activePage === 'budgets' && (
            <BudgetsPage
              month={month}
              shared={shared}
              groups={summary.byGroup}
              summary={summary}
              budgetFormRevision={budgetFormRevision}
              onSave={saveBudgets}
              onExport={exportBudgetCsv}
              onCopyPrevious={copyPreviousMonthBudget}
              onAddCategory={(groupId) => openCategoryForm(groupId)}
              onEditCategory={(category) => openCategoryForm(category.groupId, category)}
            />
          )}

          {activePage === 'settings' && (
            <SettingsPage
              month={month}
              monthActivityCount={monthActivities.length}
              isSaving={isSaving}
              shared={shared}
              householdName={householdName}
              userEmail={userEmail}
              canCreateInvite={canCreateInvite}
              invite={invite}
              inviteError={inviteError}
              isCreatingInvite={isCreatingInvite}
              onCreateInvite={onCreateInvite}
              onClearInvite={onClearInvite}
              onSignOut={onSignOut}
              onImport={importBudgetFile}
              onRestoreBackup={restoreBackupFile}
              onExportActivities={exportActivityCsv}
              onExportBudgets={exportBudgetCsv}
              onExportBackup={() =>
                downloadFile(
                  'household-budget-backup.json',
                  exportBudgetBackup(data),
                  'application/json',
                )
              }
              onClearMonthActivity={clearSelectedMonthActivity}
            />
          )}
        </div>
      </main>

      {showActivityForm && (
        <ActivityForm
          activity={editingActivity}
          groups={groups}
          onClose={() => {
            setShowActivityForm(false)
            setEditingActivity(null)
            setError('')
          }}
          onSubmit={saveActivity}
        />
      )}

      {categoryFormGroupId && (
        <CategoryForm
          category={editingCategory}
          group={groups.find((item) => item.id === categoryFormGroupId)}
          error={error}
          onClose={() => {
            setCategoryFormGroupId(null)
            setEditingCategory(null)
            setError('')
          }}
          onSubmit={saveCategory}
        />
      )}

      <nav className="mobile-nav" aria-label="Main navigation">
        {navigation.map((item) => (
          <button
            className={activePage === item.id ? 'active' : ''}
            key={item.id}
            onClick={() => setActivePage(item.id)}
            aria-current={activePage === item.id ? 'page' : undefined}
          >
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action}
    </div>
  )
}

function StatCard({ label, value, note, tone = 'default', icon, overBudget = false }) {
  return (
    <article className={`stat-card stat-${tone}${overBudget ? ' stat-over-budget' : ''}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon" aria-hidden="true">{icon}</span>
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  )
}

function BudgetReviewSummary({ groups }) {
  const categories = groups.flatMap((group) => group.categories)
  const overBudgetCount = categories.filter((category) => category.isOverBudget).length
  const missingRequiredCount = categories.filter(
    (category) => category.isMissingRequiredEntry,
  ).length
  const funMoneyGroup = groups.find((group) => group.id === 'fun-money')
  const incompleteFunMoneyCount = funMoneyGroup
    ? funMoneyGroup.categories.filter(
      (category) => category.plannedCents > 0 && category.actualCents < category.plannedCents,
    ).length
    : 0
  const incompleteEntryCount = missingRequiredCount + incompleteFunMoneyCount

  if (overBudgetCount === 0 && incompleteEntryCount === 0) return null

  return (
    <aside className="budget-review-summary" aria-label="Budget review" role="status">
      {overBudgetCount > 0 && (
        <span className="budget-review-item budget-review-over">
          {overBudgetCount} {overBudgetCount === 1 ? 'category' : 'categories'} over plan
        </span>
      )}
      {incompleteEntryCount > 0 && (
        <span className="budget-review-item budget-review-required">
          {incompleteEntryCount} {incompleteEntryCount === 1 ? 'entry' : 'entries'} not fully recorded
        </span>
      )}
    </aside>
  )
}

function OverviewPage({
  month,
  summary,
  groups,
  categoryById,
  activities,
  onOpenBudgets,
  onOpenActivity,
}) {
  const hasBudgets = summary.byGroup.some((group) => group.plannedCents !== 0)
  const expenseProgress = summary.plannedExpensesCents > 0
    ? Math.min(100, Math.round(summary.actualExpensesCents / summary.plannedExpensesCents * 100))
    : 0
  const funMoneyGroup = summary.byGroup.find((group) => group.id === 'fun-money')

  return (
    <>
      <PageHeading
        eyebrow={getMonthLabel(month).toUpperCase()}
        title="Your money, in view."
        description="A clear picture of what came in, where it went, and what’s left."
        action={
          <button className="button button-secondary desktop-budget-button" onClick={onOpenBudgets}>
            Edit monthly plan
          </button>
        }
      />

      <BudgetReviewSummary groups={groups} />

      {!hasBudgets && (
        <div className="setup-callout">
          <div>
            <strong>Start with your monthly plan</strong>
            <p>Import the budget sheet as a CSV or add planned amounts in Budgets.</p>
          </div>
          <button className="button button-primary" onClick={onOpenBudgets}>Set up budgets</button>
        </div>
      )}

      <section className="stat-grid" aria-label="Monthly budget summary">
        <StatCard
          label="Monthly income"
          value={formatMoney(summary.actualIncomeCents)}
          note={`of ${formatMoney(summary.plannedIncomeCents)} planned`}
          tone="mint"
          icon="↘"
        />
        <StatCard
          label="Spent + debt"
          value={formatMoney(summary.actualExpensesCents)}
          note={`of ${formatMoney(summary.plannedExpensesCents)} planned${summary.actualExpensesCents > summary.plannedExpensesCents ? ' · Over plan' : ''}`}
          tone="peach"
          overBudget={summary.actualExpensesCents > summary.plannedExpensesCents}
          icon="↗"
        />
        <StatCard
          label="Savings"
          value={formatMoney(summary.actualSavingsCents)}
          note={`of ${formatMoney(summary.plannedSavingsCents)} planned${summary.actualSavingsCents > summary.plannedSavingsCents ? ' · Over plan' : ''}`}
          tone="lavender"
          overBudget={summary.actualSavingsCents > summary.plannedSavingsCents}
          icon="◇"
        />
        <StatCard
          label="After expenses & savings"
          value={formatMoney(summary.actualSurplusCents)}
          note="See each person's status below"
          tone={summary.actualSurplusCents < 0 ? 'peach' : 'mint'}
          icon="＝"
        />
      </section>

      <section className="overview-lower">
        <article className="panel budget-overview-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">YOUR PLAN</p>
              <h2>Budget by category</h2>
            </div>
            <button className="text-button" onClick={onOpenBudgets}>View all <span aria-hidden="true">→</span></button>
          </div>
          <div className="overall-progress">
            <div className="progress-copy">
              <span>Spending progress</span>
              <strong>{expenseProgress}%</strong>
            </div>
            <div className={`progress-track${summary.actualExpensesCents > summary.plannedExpensesCents ? ' over-budget-track' : ''}`} role="progressbar" aria-label="Spending progress" aria-valuenow={expenseProgress} aria-valuemin="0" aria-valuemax="100">
              <span style={{ width: `${expenseProgress}%` }} />
            </div>
          </div>
          <div className="group-summary-list">
            {groups.filter((group) => group.type !== 'allocation').map((group) => {
              const progress = group.plannedCents > 0
                ? Math.min(100, Math.round(group.actualCents / group.plannedCents * 100))
                : 0
              return (
                <details
                  className={`group-summary${group.isOverBudget ? ' over-budget' : ''}${group.hasMissingRequiredEntry ? ' required-entry-missing' : ''}`}
                  key={group.id}
                >
                  <summary>
                    <span className={`group-dot dot-${group.type}`} />
                    <span className="group-summary-name">{group.name}</span>
                    <span className="group-summary-amount">
                      {formatMoney(group.actualCents)}{' '}
                      <small>
                        of {formatMoney(group.plannedCents)}
                        {group.isOverBudget && (
                          <span className="over-budget-inline"> · Over plan</span>
                        )}
                        {group.hasMissingRequiredEntry && (
                          <span className="required-entry-inline"> · Missing</span>
                        )}
                      </small>
                    </span>
                    <span className="group-progress-mini" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
                    <span className="group-chevron" aria-hidden="true" />
                  </summary>
                  <div className="group-detail-list">
                    {group.categories.map((category) => (
                      <div
                        className={`group-detail-row${category.isOverBudget ? ' over-budget' : ''}${category.isMissingRequiredEntry ? ' missing-required-row' : ''}`}
                        key={category.id}
                      >
                        <span>{category.name}</span>
                        <span className={category.isOverBudget ? 'over-budget-amount' : ''}>
                          {formatMoney(category.actualCents)} <small>/ {formatMoney(category.plannedCents)}</small>
                          {category.isMissingRequiredEntry && (
                            <small className="required-entry-status">Not recorded</small>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )
            })}
          </div>
        </article>

        <article className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">RECENT</p>
              <h2>Latest activity</h2>
            </div>
          </div>
          {activities.length ? (
            <ActivityList
              activities={activities.slice(0, 6)}
              categoryById={categoryById}
              groups={groups}
              onEdit={onOpenActivity}
              compact
            />
          ) : (
            <EmptyState
              title="Nothing here yet"
              description="Add your first income or expense to start seeing the month take shape."
            />
          )}
        </article>
      </section>

      <section className="panel fun-money-checkin" aria-label="Fun money activity check-in">
        <div className="fun-money-checkin-heading">
          <div>
            <p className="eyebrow">FUN MONEY</p>
            <h2>Activity check-in</h2>
          </div>
          <p>Recorded spending compared with each person's allocation.</p>
        </div>
        <div className="fun-money-checkin-grid">
          {funMoneyGroup.categories.map((category) => {
            const hasPositiveAllocation = category.plannedCents > 0
            const recordedCents = Math.max(0, category.actualCents)
            const status = !hasPositiveAllocation
              ? 'inactive'
              : recordedCents <= 0
                ? 'pending'
                : recordedCents < category.plannedCents
                  ? 'partial'
                  : 'recorded'
            const statusLabel = {
              inactive: 'No allocation',
              pending: 'Not recorded',
              partial: 'Partially recorded',
              recorded: 'Recorded',
            }[status]
            const detail = hasPositiveAllocation
              ? `${formatMoney(recordedCents)} of ${formatMoney(category.plannedCents)} recorded`
              : 'No positive allocation this month'

            return (
              <article className={`fun-money-person-card is-${status}`} key={category.id}>
                <div className="fun-money-person-heading">
                  <strong>{category.name.replace(/ Fun Money$/, '')}</strong>
                  <span className={`fun-money-status-label is-${status}`}>{statusLabel}</span>
                </div>
                <div className="fun-money-person-detail">
                  <strong className={`fun-money-allocation is-${status}`}>
                    {formatMoney(category.plannedCents)}
                  </strong>
                  <span>{detail}</span>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      <section className="cashflow-strip" aria-labelledby="cashflow-strip-heading">
        <h2 className="cashflow-strip-heading" id="cashflow-strip-heading">
          Monthly cash flow
        </h2>
        <div><span>Actual income</span><strong>{formatMoney(summary.actualIncomeCents)}</strong></div>
        <div><span>Actual expenses + debt</span><strong>{formatMoney(summary.actualExpensesCents)}</strong></div>
        <div><span>Actual savings</span><strong>{formatMoney(summary.actualSavingsCents)}</strong></div>
        <div><span>Fun money available, each</span><strong>{formatMoney(summary.perPersonFunMoneyCents)}</strong></div>
        <div className="cashflow-ending">
          <span>Surplus vs. Plan</span>
          <strong className={
            summary.endingBalanceCents > 0
              ? 'cashflow-positive'
              : summary.endingBalanceCents < 0
                ? 'cashflow-negative'
                : undefined
          }>
            {formatMoney(summary.endingBalanceCents)}
          </strong>
        </div>
      </section>
    </>
  )
}

function EmptyState({ title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">+</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  )
}

function ActivityList({
  activities,
  categoryById,
  groups,
  onEdit,
  onDelete,
  compact = false,
}) {
  return (
    <div className={`activity-list ${compact ? 'activity-list-compact' : ''}`}>
      {activities.map((activity) => {
        const category = categoryById[activity.categoryId]
        const group = groups.find((item) => item.id === category?.groupId)
        const sign = category?.type === 'income' ? '+' : '−'
        return (
          <article className="activity-row" key={activity.id}>
            <div className={`activity-avatar avatar-${category?.type ?? 'expense'}`} aria-hidden="true">
              {category?.type === 'income' ? '↙' : category?.type === 'savings' ? '◇' : '↗'}
            </div>
            <div className="activity-main">
              <strong>{activity.description}</strong>
              <span>{category?.name ?? 'Unknown category'}{group ? ` · ${group.name}` : ''}</span>
            </div>
            <time className="activity-date" dateTime={activity.date}>{formatActivityDate(activity.date)}</time>
            <strong className={`activity-amount ${category?.type === 'income' ? 'amount-income' : ''}`}>
              {sign}{formatMoney(activity.amountCents)}
            </strong>
            {!compact && (
              <div className="activity-actions">
                <button className="text-button" onClick={() => onEdit(activity)}>Edit</button>
                <button className="text-button danger-text" onClick={() => onDelete(activity)}>Delete</button>
              </div>
            )}
            {compact && onEdit && (
              <button className="row-edit" onClick={() => onEdit(activity)} aria-label={`Edit ${activity.description}`}>···</button>
            )}
          </article>
        )
      })}
    </div>
  )
}

function formatActivityDate(date) {
  const value = new Date(`${date}T12:00:00`)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(value)
}

function ActivityPage({
  month,
  activities,
  groups,
  categoryById,
  onEdit,
  onDelete,
  onAdd,
}) {
  const [query, setQuery] = useState('')
  const filtered = activities.filter((activity) => {
    const category = categoryById[activity.categoryId]
    const searchText = `${activity.description} ${category?.name ?? ''} ${activity.note ?? ''}`.toLowerCase()
    return searchText.includes(query.toLowerCase())
  })

  return (
    <>
      <PageHeading
        eyebrow={getMonthLabel(month).toUpperCase()}
        title="Activity"
        description="Income, expenses, savings, and fun-money activity for this month."
        action={
          <button className="button button-primary button-add-activity" onClick={onAdd}>
            <span className="add-activity-icon" aria-hidden="true" />
            <span>Add activity</span>
          </button>
        }
      />
      <section className="panel activity-panel">
        <div className="panel-toolbar">
          <div>
            <h2>All activity</h2>
            <span className="muted-copy">{activities.length} {activities.length === 1 ? 'entry' : 'entries'}</span>
          </div>
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Search activity</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity" />
          </label>
        </div>
        {filtered.length ? (
          <ActivityList
            activities={filtered}
            categoryById={categoryById}
            groups={groups}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ) : (
          <EmptyState
            title={query ? 'No matching activity' : 'No activity this month'}
            description={query ? 'Try another description or category.' : 'When you add an activity, it will appear here.'}
          />
        )}
      </section>
    </>
  )
}

function BudgetsPage({
  month,
  shared,
  groups,
  summary,
  budgetFormRevision,
  onSave,
  onExport,
  onCopyPrevious,
  onAddCategory,
  onEditCategory,
}) {
  return (
    <>
      <PageHeading
        eyebrow={getMonthLabel(month).toUpperCase()}
        title="Monthly plan"
        description="Set a plan for each category. Copy the previous month to start from that plan; activity is not copied."
        action={
          <div className="page-heading-actions">
            <button
              className="button button-secondary"
              onClick={onCopyPrevious}
              title={`Copy ${getMonthLabel(getPreviousMonthKey(month))} plan to ${getMonthLabel(month)}`}
            >
              Copy previous month
            </button>
            <button className="button button-secondary" onClick={onExport}>Export budget CSV</button>
          </div>
        }
      />
      <div className="budget-topline">
        <div><span>Income planned</span><strong>{formatMoney(summary.plannedIncomeCents)}</strong></div>
        <div><span>Expenses + debt</span><strong>{formatMoney(summary.plannedExpensesCents)}</strong></div>
        <div><span>Savings planned</span><strong>{formatMoney(summary.plannedSavingsCents)}</strong></div>
        <div className="highlight-budget"><span>Fun money available each</span><strong>{formatMoney(summary.perPersonFunMoneyCents)}</strong></div>
      </div>
      <form className="budget-groups" key={`${month}-${budgetFormRevision}`} onSubmit={onSave}>
        {groups.map((group) => (
          <section className="panel budget-group-panel" key={group.id}>
            <div
              className={`budget-group-heading${group.isOverBudget ? ' over-budget' : ''}${group.hasMissingRequiredEntry ? ' required-entry-missing' : ''}`}
            >
              <div>
                <span className={`group-dot dot-${group.type}`} />
                <h2>{group.name}</h2>
                {group.isOverBudget && (
                  <span className="over-budget-badge">Over plan</span>
                )}
                {group.hasMissingRequiredEntry && (
                  <span className="required-entry-badge">Missing entries</span>
                )}
              </div>
              <div className="budget-group-controls">
                {group.type !== 'allocation' && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => onAddCategory(group.id)}
                  >
                    + Add category
                  </button>
                )}
                <div className="budget-group-totals">
                  <span className={group.isOverBudget ? 'over-budget-amount' : ''}>
                    <span>Actual</span>
                    <strong>{formatMoney(group.actualCents)}</strong>
                  </span>
                  <span>
                    <span>Plan</span>
                    <strong>{formatMoney(group.plannedCents)}</strong>
                  </span>
                </div>
              </div>
            </div>
            <div className="budget-category-grid">
              {group.categories.map((category) => (
                <div
                  className={`budget-category-row${category.isOverBudget ? ' over-budget-row' : ''}${category.isMissingRequiredEntry ? ' missing-required-row' : ''}`}
                  key={category.id}
                >
                  <div className="budget-category-label">
                    <strong>{category.name}</strong>
                    <small className={[
                      category.isOverBudget ? 'over-budget-amount' : '',
                      category.isMissingRequiredEntry ? 'required-entry-status' : '',
                    ].filter(Boolean).join(' ')}>
                      <strong className="budget-category-actual">
                        {formatMoney(category.actualCents)} actual
                      </strong>
                      {category.isOverBudget && (
                        <span className="over-budget-inline"> · Over plan</span>
                      )}
                      {category.isMissingRequiredEntry ? ' · Not recorded' : ''}
                    </small>
                  </div>
                  {category.type === 'allocation' ? (
                    <span className="derived-amount">{formatMoney(category.plannedCents)} <small>calculated</small></span>
                  ) : (
                    <span className="currency-input">
                      <span>$</span>
                      <input
                        aria-label={`${category.name} planned amount`}
                        inputMode="decimal"
                        type="number"
                        min="0"
                        step="0.01"
                        name={category.id}
                        defaultValue={(category.plannedCents / 100).toFixed(2)}
                      />
                    </span>
                  )}
                  {category.type !== 'allocation' && (
                    <button
                      className="text-button category-edit-button"
                      type="button"
                      aria-label={`Rename ${category.name}`}
                      onClick={() => onEditCategory(category)}
                    >
                      Edit
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        <div className="form-footer sticky-form-footer">
          <span>{shared ? 'Changes sync to the shared household.' : 'Changes are saved only in this browser.'}</span>
          <button className="button button-primary" type="submit">Save monthly plan</button>
        </div>
      </form>
    </>
  )
}

function SettingsPage({
  month,
  monthActivityCount,
  isSaving,
  shared,
  householdName,
  userEmail,
  canCreateInvite,
  invite,
  inviteError,
  isCreatingInvite,
  onCreateInvite,
  onClearInvite,
  onSignOut,
  onImport,
  onRestoreBackup,
  onExportActivities,
  onExportBudgets,
  onExportBackup,
  onClearMonthActivity,
}) {
  return (
    <>
      <PageHeading
        eyebrow="PREFERENCES"
        title="Settings"
        description={shared
          ? 'Manage household access, import budget plans, and keep a safe copy of your shared data.'
          : 'Import your current category budgets and keep a safe copy of this browser’s data.'}
      />
      <div className="settings-grid">
        {shared && (
          <section className="panel settings-card household-access-card">
            <p className="eyebrow">HOUSEHOLD ACCESS</p>
            <h2>{householdName}</h2>
            <p>Signed in as {userEmail}. Both household members can view and update the same live budget.</p>
            {canCreateInvite ? (
              <>
                <button
                  className="button button-primary"
                  onClick={onCreateInvite}
                  disabled={isCreatingInvite}
                >
                  {isCreatingInvite ? 'Creating code…' : 'Create one-time invite code'}
                </button>
                {invite && (
                  <div className="invite-code-panel" role="status">
                    <p>Share this code privately. It can be used once and expires in 24 hours.</p>
                    <code>{invite.code}</code>
                    <small>Expires {new Date(invite.expiresAt).toLocaleString()}</small>
                    <button className="text-button" onClick={onClearInvite}>Hide code</button>
                  </div>
                )}
              </>
            ) : (
              <p className="privacy-caption">Only the household owner can create an invitation.</p>
            )}
            {inviteError && <p className="auth-error" role="alert">{inviteError}</p>}
            <button className="button button-secondary sign-out-button" onClick={onSignOut}>Sign out</button>
          </section>
        )}

        <section className="panel settings-card">
          <p className="eyebrow">BUDGET SETUP</p>
          <h2>Import from your sheet</h2>
          <p>Export the active monthly worksheet as a CSV. We’ll read category names and planned amounts from the first two columns in this browser.</p>
          <ul className="settings-list">
            <li>Choose the CSV exported from the current worksheet.</li>
            <li>Confirm that the month selector is set to the budget month you want to update ({getMonthLabel(month)}).</li>
              <li>Matching category budgets are imported. New months use this plan as a starting point; activity history is not imported.</li>
          </ul>
          <label className="button button-primary file-button">
            Import budget CSV
            <input type="file" accept=".csv,text/csv" onChange={onImport} />
          </label>
          <p className="privacy-caption">
            {shared
              ? 'The CSV is processed in this browser; the imported budget changes sync to the household.'
              : 'Your file is processed in this browser and is not uploaded.'}
          </p>
        </section>

        <section className="panel settings-card">
          <p className="eyebrow">BACKUP & EXPORT</p>
          <h2>Take your data with you</h2>
          <p>{shared
            ? 'The shared budget is stored in your Firebase project. Export a backup before replacing data or changing projects.'
            : 'Phase 1 stores data in browser storage, which is not encrypted. Export a backup before clearing site data or switching browsers, and keep your device profile private.'}</p>
          <div className="settings-actions">
            <button className="button button-secondary" onClick={onExportBackup}>Download full backup</button>
            <button className="button button-secondary" onClick={onExportActivities}>Export activity CSV</button>
            <button className="button button-secondary" onClick={onExportBudgets}>Export budget CSV</button>
            <label className="button button-secondary file-button backup-import">
              Restore full backup
              <input type="file" accept=".json,application/json" onChange={onRestoreBackup} />
            </label>
          </div>
        </section>

        <section className="panel settings-card settings-warning">
          <p className="eyebrow">MONTHLY ACTIVITY</p>
          <h2>Clear activity for {getMonthLabel(month)}</h2>
          <p>{monthActivityCount
            ? `This deletes ${monthActivityCount} income, expense, and savings ${monthActivityCount === 1 ? 'entry' : 'entries'} for this month only. The monthly plan and activity in other months stay unchanged. Download a backup first if you may need these entries later.`
            : `There is no activity to clear for ${getMonthLabel(month)}. Your monthly plan is unchanged.`}</p>
          <button
            className="button button-danger"
            onClick={onClearMonthActivity}
            disabled={monthActivityCount === 0 || isSaving}
          >
            {isSaving
              ? 'Saving changes…'
              : monthActivityCount
                ? `Clear ${monthActivityCount} ${monthActivityCount === 1 ? 'entry' : 'entries'}`
                : 'No activity to clear'}
          </button>
        </section>
      </div>
    </>
  )
}

function CategoryForm({ category, group, error, onClose, onSubmit }) {
  const [name, setName] = useState(category?.name ?? '')

  function submit(event) {
    event.preventDefault()
    onSubmit({ name })
  }

  function handleDialogKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key !== 'Tab') return
    const focusable = event.currentTarget.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className="activity-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-dialog-title"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{category ? 'EDIT CATEGORY' : 'NEW CATEGORY'}</p>
            <h2 id="category-dialog-title">
              {category ? 'Rename category' : 'Add budget category'}
            </h2>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close form">×</button>
        </div>
        <form className="activity-form" onSubmit={submit}>
          <label>
            <span>Category name</span>
            <input
              autoFocus
              required
              maxLength="60"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Pet care"
            />
          </label>
          <p className="category-group-note">
            Group: <strong>{group.name}</strong>.{' '}
            {category
              ? 'Existing budgets and activity stay with this category when renamed.'
              : 'This category uses the group’s budget type.'}
          </p>
          {error && <p className="category-form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit">
              {category ? 'Save name' : 'Add category'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ActivityForm({ activity, groups, onClose, onSubmit }) {
  const [description, setDescription] = useState(activity?.description ?? '')
  const [amount, setAmount] = useState(
    activity ? (activity.amountCents / 100).toFixed(2) : '',
  )
  const [categoryId, setCategoryId] = useState(
    activity?.categoryId ?? groups.flatMap((group) => group.categories)[0].id,
  )
  const [date, setDate] = useState(activity?.date ?? getTodayDate())
  const [note, setNote] = useState(activity?.note ?? '')

  function submit(event) {
    event.preventDefault()
    const saved = onSubmit({ description, amount, categoryId, date, note })
    if (saved) {
      setDescription('')
      setAmount('')
    }
  }

  function handleDialogKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key !== 'Tab') return
    const focusable = event.currentTarget.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    )
    const first = focusable[0]
    const last = focusable[focusable.length - 1]

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className="activity-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-dialog-title"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">{activity ? 'UPDATE ENTRY' : 'NEW ENTRY'}</p>
            <h2 id="activity-dialog-title">{activity ? 'Edit activity' : 'Add activity'}</h2>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Close form">×</button>
        </div>
        <form className="activity-form" onSubmit={submit}>
          <label>
            <span>Description</span>
            <input
              autoFocus
              required
              maxLength="100"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="e.g. Grocery run"
            />
          </label>
          <div className="form-row">
            <label>
              <span>Amount</span>
              <div className="form-currency-input">
                <span>$</span>
                <input
                  required
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.00"
                />
              </div>
            </label>
            <label>
              <span>Date</span>
              <input
                required
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          </div>
          <label>
            <span>Category</span>
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {groups.map((group) => (
                <optgroup label={group.name} key={group.id}>
                  {group.categories.map((category) => (
                    <option value={category.id} key={category.id}>{category.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span>Note <small>(optional)</small></span>
            <textarea
              rows="2"
              maxLength="300"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a note"
            />
          </label>
          <div className="dialog-actions">
            <button className="button button-secondary" type="button" onClick={onClose}>Cancel</button>
            <button className="button button-primary" type="submit">{activity ? 'Save changes' : 'Add activity'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function getTodayDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export default App
