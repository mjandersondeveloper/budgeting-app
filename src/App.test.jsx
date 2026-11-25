import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { getCurrentMonthKey, getMonthLabel, getPreviousMonthKey } from './domain/budget'
import { createInitialBudgetData, saveBudgetData } from './services/localBudgetStore'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('budget app phase 1', () => {
  it('copies the previous month budget without copying activity or changing the template', async () => {
    const user = userEvent.setup()
    const month = getCurrentMonthKey()
    const previousMonth = getPreviousMonthKey(month)
    const data = createInitialBudgetData(month)
    data.budgetTemplate = { 'home-bills:mortgage': 80000 }
    data.budgetsByMonth[previousMonth] = { 'home-bills:mortgage': 120000 }
    data.activities.push({
      id: 'previous-month-entry',
      date: `${previousMonth}-18`,
      description: 'Previous month activity',
      categoryId: 'home-bills:mortgage',
      amountCents: 50000,
    })
    saveBudgetData(data)

    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Budgets' })[0])
    expect(screen.getByLabelText('Mortgage planned amount')).toHaveValue(800)

    await user.click(screen.getByRole('button', { name: 'Copy previous month' }))

    expect(screen.getByLabelText('Mortgage planned amount')).toHaveValue(1200)
    expect(screen.getByText(/copied .* plan to/i)).toBeInTheDocument()
    const saved = JSON.parse(window.localStorage.getItem('household-budget-phase1-v1'))
    expect(saved.budgetsByMonth[month]['home-bills:mortgage']).toBe(120000)
    expect(saved.budgetTemplate['home-bills:mortgage']).toBe(80000)
    expect(saved.activities).toHaveLength(1)
  })

  it('asks before replacing a plan already saved for the selected month', async () => {
    const user = userEvent.setup()
    const month = getCurrentMonthKey()
    const previousMonth = getPreviousMonthKey(month)
    const data = createInitialBudgetData(month)
    data.budgetTemplate = { 'home-bills:mortgage': 80000 }
    data.budgetsByMonth[previousMonth] = { 'home-bills:mortgage': 120000 }
    data.budgetsByMonth[month] = { 'home-bills:mortgage': 90000 }
    saveBudgetData(data)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Budgets' })[0])
    await user.click(screen.getByRole('button', { name: 'Copy previous month' }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Mortgage planned amount')).toHaveValue(900)
    const saved = JSON.parse(window.localStorage.getItem('household-budget-phase1-v1'))
    expect(saved.budgetsByMonth[month]['home-bills:mortgage']).toBe(90000)
  })

  it('adds and renames a category while preserving its budget and activity', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Budgets' })[0])

    const petsGroup = screen.getByRole('heading', { name: 'Pets' })
      .closest('.budget-group-panel')
    await user.click(within(petsGroup).getByRole('button', { name: '+ Add category' }))
    const categoryDialog = screen.getByRole('dialog', { name: 'Add budget category' })
    await user.type(within(categoryDialog).getByLabelText('Category name'), 'Bird Supplies')
    await user.click(within(categoryDialog).getByRole('button', { name: 'Add category' }))

    const categoryBudget = screen.getByLabelText('Bird Supplies planned amount')
    await user.clear(categoryBudget)
    await user.type(categoryBudget, '75')
    await user.click(screen.getByRole('button', { name: /save monthly plan/i }))

    await user.click(screen.getAllByRole('button', { name: /add activity/i })[0])
    const activityDialog = screen.getByRole('dialog', { name: /add activity/i })
    await user.type(within(activityDialog).getByLabelText(/description/i), 'Pet store')
    await user.type(within(activityDialog).getByLabelText(/amount/i), '40')
    const saved = JSON.parse(window.localStorage.getItem('household-budget-phase1-v1'))
    const customCategory = saved.customCategories[0]
    await user.selectOptions(
      within(activityDialog).getByLabelText(/category/i),
      customCategory.id,
    )
    await user.click(within(activityDialog).getByRole('button', { name: /add activity/i }))
    await user.click(screen.getAllByRole('button', { name: 'Activity' })[0])
    expect(screen.getByText('Bird Supplies · Pets')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Budgets' })[0])
    const updatedGroup = screen.getByRole('heading', { name: 'Pets' })
      .closest('.budget-group-panel')
    await user.click(within(updatedGroup).getByRole('button', { name: 'Rename Bird Supplies' }))
    const editDialog = screen.getByRole('dialog', { name: 'Rename category' })
    const categoryName = within(editDialog).getByLabelText('Category name')
    await user.clear(categoryName)
    await user.type(categoryName, 'Bird Supplies & Pet Care')
    await user.click(within(editDialog).getByRole('button', { name: 'Save name' }))

    expect(screen.getByLabelText('Bird Supplies & Pet Care planned amount')).toHaveValue(75)
    const updated = JSON.parse(window.localStorage.getItem('household-budget-phase1-v1'))
    expect(updated.customCategories[0].name).toBe('Bird Supplies & Pet Care')
    expect(updated.budgetTemplate[customCategory.id]).toBe(7500)
    expect(updated.activities[0].categoryId).toBe(customCategory.id)
  })

  it('renames a built-in category without changing its identifier', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Budgets' })[0])

    const homeBills = screen.getByRole('heading', { name: 'Home / Bills' })
      .closest('.budget-group-panel')
    await user.click(within(homeBills).getByRole('button', { name: 'Rename Mortgage' }))
    const dialog = screen.getByRole('dialog', { name: 'Rename category' })
    const nameInput = within(dialog).getByLabelText('Category name')
    await user.clear(nameInput)
    await user.type(nameInput, 'Home Payment')
    await user.click(within(dialog).getByRole('button', { name: 'Save name' }))

    expect(screen.getByLabelText('Home Payment planned amount')).toBeInTheDocument()
    expect(screen.queryByLabelText('Mortgage planned amount')).not.toBeInTheDocument()
    const saved = JSON.parse(window.localStorage.getItem('household-budget-phase1-v1'))
    expect(saved.categoryNameOverrides['home-bills:mortgage']).toBe('Home Payment')
  })

  it('shows an error when a category name already exists in its group', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Budgets' })[0])

    const foodGroup = screen.getByRole('heading', { name: 'Food & Dining' })
      .closest('.budget-group-panel')
    await user.click(within(foodGroup).getByRole('button', { name: '+ Add category' }))
    const dialog = screen.getByRole('dialog', { name: 'Add budget category' })
    await user.type(within(dialog).getByLabelText('Category name'), 'Costco')
    await user.click(within(dialog).getByRole('button', { name: 'Add category' }))

    expect(within(dialog).getByRole('alert'))
      .toHaveTextContent(/already exists in food & dining/i)
    expect(window.localStorage.getItem('household-budget-phase1-v1')).toBeNull()
  })

  it('uses the household name and highlights overspending but not income', () => {
    const month = getCurrentMonthKey()
    const groceryCategory = 'monthly-misc:kroger-giant-eagle'
    const incomeCategory = 'income:marcus-after-tax-income'
    const data = createInitialBudgetData(month)
    data.budgetTemplate = { [groceryCategory]: 1000, [incomeCategory]: 1000 }
    data.budgetsByMonth[month] = data.budgetTemplate
    data.activities = [
      {
        id: 'grocery',
        date: `${month}-01`,
        description: 'Grocery run',
        categoryId: groceryCategory,
        amountCents: 1500,
      },
      {
        id: 'pay',
        date: `${month}-02`,
        description: 'Paycheck',
        categoryId: incomeCategory,
        amountCents: 150000,
      },
    ]
    saveBudgetData(data)

    render(<App />)

    expect(screen.getByText('The Andersons')).toBeInTheDocument()
    expect(screen.getByText('Spent + debt').closest('.stat-card')).toHaveClass('stat-over-budget')
    expect(screen.getByText('Monthly income').closest('.stat-card')).not.toHaveClass('stat-over-budget')

    fireEvent.click(screen.getAllByRole('button', { name: 'Budgets' })[0])
    expect(screen.getByLabelText('Kroger/Giant Eagle planned amount').closest('.budget-category-row'))
      .toHaveClass('over-budget-row')
    expect(screen.getByLabelText('Marcus After-Tax Income planned amount').closest('.budget-category-row'))
      .not.toHaveClass('over-budget-row')
  })

  it('clearly explains device-local storage and adds activity to the month', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText(/this browser only/i)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /add activity/i })[0])

    const dialog = screen.getByRole('dialog', { name: /add activity/i })
    await user.type(within(dialog).getByLabelText(/description/i), 'Grocery run')
    await user.type(within(dialog).getByLabelText(/amount/i), '42.15')
    await user.selectOptions(
      within(dialog).getByLabelText(/category/i),
      'monthly-misc:kroger-giant-eagle',
    )
    await user.click(within(dialog).getByRole('button', { name: /add activity/i }))

    expect(screen.getByText('Grocery run')).toBeInTheDocument()
    expect(screen.getAllByText('-$42.15')).not.toHaveLength(0)
    expect(
      JSON.parse(window.localStorage.getItem('household-budget-phase1-v1')).activities,
    ).toHaveLength(1)
  })

  it('clears only selected-month activity and preserves plans and other months', async () => {
    const user = userEvent.setup()
    const currentMonth = getCurrentMonthKey()
    const selectedMonth = getPreviousMonthKey(currentMonth)
    const selectedMonthLabel = getMonthLabel(selectedMonth)
    const data = createInitialBudgetData(currentMonth)
    data.budgetTemplate = { 'home-bills:mortgage': 80000 }
    data.budgetsByMonth[selectedMonth] = { 'home-bills:mortgage': 120000 }
    data.activities = [
      {
        id: 'selected-month-paycheck',
        date: `${selectedMonth}-03`,
        description: 'Selected-month paycheck',
        categoryId: 'income:marcus-after-tax-income',
        amountCents: 150000,
      },
      {
        id: 'selected-month-groceries',
        date: `${selectedMonth}-06`,
        description: 'Selected-month groceries',
        categoryId: 'monthly-misc:kroger-giant-eagle',
        amountCents: 8500,
      },
      {
        id: 'other-month-entry',
        date: `${currentMonth}-25`,
        description: 'Other month entry',
        categoryId: 'home-bills:mortgage',
        amountCents: 120000,
      },
    ]
    saveBudgetData(data)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Budget month'), {
      target: { value: selectedMonth },
    })
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])

    await user.click(screen.getByRole('button', { name: 'Clear 2 entries' }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0][0]).toContain(selectedMonthLabel)
    expect(screen.getByText(/Cleared 2 activity entries/)).toBeInTheDocument()
    const saved = JSON.parse(window.localStorage.getItem('household-budget-phase1-v1'))
    expect(saved.activities.map((activity) => activity.id)).toEqual([
      'other-month-entry',
    ])
    expect(saved.budgetTemplate['home-bills:mortgage']).toBe(80000)
    expect(saved.budgetsByMonth[selectedMonth]['home-bills:mortgage']).toBe(120000)
  })

  it('leaves activity unchanged when clearing the selected month is cancelled', async () => {
    const user = userEvent.setup()
    const month = getCurrentMonthKey()
    const data = createInitialBudgetData(month)
    data.activities.push({
      id: 'current-entry',
      date: `${month}-03`,
      description: 'Current entry',
      categoryId: 'home-bills:mortgage',
      amountCents: 120000,
    })
    saveBudgetData(data)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    await user.click(screen.getByRole('button', { name: 'Clear 1 entry' }))

    expect(confirm).toHaveBeenCalledOnce()
    expect(
      JSON.parse(window.localStorage.getItem('household-budget-phase1-v1')).activities,
    ).toHaveLength(1)
  })

  it('allows navigating to the category budget editor', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Budgets' })[0])

    expect(screen.getByRole('heading', { name: 'Monthly plan' })).toBeInTheDocument()
    expect(screen.getByLabelText('Mortgage planned amount')).toHaveValue(0)
  })

  it('saves monthly plans as defaults for months without an override', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: 'Budgets' })[0])

    const mortgageBudget = screen.getByLabelText('Mortgage planned amount')
    await user.clear(mortgageBudget)
    await user.type(mortgageBudget, '1500')
    await user.click(screen.getByRole('button', { name: /save monthly plan/i }))

    const saved = JSON.parse(window.localStorage.getItem('household-budget-phase1-v1'))
    expect(saved.budgetTemplate['home-bills:mortgage']).toBe(150000)
    expect(saved.budgetsByMonth[saved.month]['home-bills:mortgage']).toBe(150000)

    fireEvent.change(screen.getByLabelText('Budget month'), {
      target: { value: '2026-12' },
    })
    expect(screen.getByLabelText('Mortgage planned amount')).toHaveValue(1500)
  })

  it('surfaces invalid activity amounts without saving', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: /add activity/i })[0])
    const dialog = screen.getByRole('dialog', { name: /add activity/i })
    await user.type(within(dialog).getByLabelText(/description/i), 'Coffee')
    await user.type(within(dialog).getByLabelText(/amount/i), '0')
    fireEvent.submit(dialog.querySelector('form'))

    expect(screen.getByRole('alert')).toHaveTextContent(/greater than zero/i)
    expect(window.localStorage.getItem('household-budget-phase1-v1')).toBeNull()
  })

  it('closes the activity dialog with Escape', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getAllByRole('button', { name: /add activity/i })[0])

    const dialog = screen.getByRole('dialog', { name: /add activity/i })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
