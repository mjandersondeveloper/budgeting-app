const makeCategory = (groupId, name, type, aliases = []) => ({
  id: `${groupId}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  groupId,
  name,
  type,
  aliases,
})

export const categoryGroups = [
  {
    id: 'home-bills',
    name: 'Home / Bills',
    type: 'expense',
    sheetHeading: 'HOME/BILLS',
    categories: [
      makeCategory('home-bills', 'Mortgage', 'expense'),
      makeCategory('home-bills', 'Internet', 'expense'),
      makeCategory('home-bills', 'Electricity', 'expense'),
      makeCategory('home-bills', 'Water/Trash', 'expense'),
      makeCategory('home-bills', 'Gas', 'expense'),
      makeCategory('home-bills', 'Marcus Cell', 'expense'),
      makeCategory('home-bills', 'Alexa Cell', 'expense'),
    ],
  },
  {
    id: 'car',
    name: 'Car',
    type: 'expense',
    sheetHeading: 'CAR',
    categories: [
      makeCategory('car', 'Gas', 'expense'),
      makeCategory('car', 'Maintenance', 'expense'),
      makeCategory('car', 'Parking', 'expense'),
      makeCategory('car', 'Car Insurance', 'expense'),
    ],
  },
  {
    id: 'insurance',
    name: 'Insurance',
    type: 'expense',
    sheetHeading: 'INSURANCE',
    categories: [
      makeCategory('insurance', 'Health Insurance', 'expense'),
      makeCategory('insurance', 'Life Insurance', 'expense'),
      makeCategory('insurance', 'Disability Insurance', 'expense'),
      makeCategory('insurance', 'Long Term Care Ins', 'expense'),
      makeCategory('insurance', 'Dental Insurance', 'expense'),
      makeCategory('insurance', 'Car Insurance', 'expense'),
    ],
  },
  {
    id: 'monthly-misc',
    name: 'Monthly Miscellaneous',
    type: 'expense',
    sheetHeading: 'MONTHLY MISC',
    categories: [
      makeCategory('monthly-misc', 'Restaurants/Bars', 'expense'),
      makeCategory('monthly-misc', 'Costco', 'expense'),
      makeCategory('monthly-misc', 'Kroger/Giant Eagle', 'expense'),
      makeCategory('monthly-misc', 'Entertainment', 'expense'),
      makeCategory('monthly-misc', 'Home Fun Stuff', 'expense'),
      makeCategory('monthly-misc', 'Home Improvement', 'expense'),
      makeCategory('monthly-misc', 'Home Furniture', 'expense'),
      makeCategory('monthly-misc', 'Toiletries/Personal Care', 'expense'),
      makeCategory('monthly-misc', 'Miscellaneous/Shopping', 'expense'),
      makeCategory('monthly-misc', 'Gifts/Donations', 'expense'),
      makeCategory('monthly-misc', 'Travel', 'expense'),
      makeCategory('monthly-misc', 'Healthcare', 'expense', ['Heathcare']),
      makeCategory(
        'monthly-misc',
        'Motz Tax (Vet, Grooming, Food, etc.)',
        'expense',
        ['Motz Tax (Vet, Grooming, etc.)'],
      ),
    ],
  },
  {
    id: 'memberships',
    name: 'Monthly Memberships',
    type: 'expense',
    sheetHeading: 'MONTHLY MEMBERSHIPS',
    categories: [
      makeCategory('memberships', 'Spotify', 'expense'),
      makeCategory('memberships', 'Netflix', 'expense'),
      makeCategory('memberships', 'YouTubeTV', 'expense'),
      makeCategory('memberships', 'Apple Cloud', 'expense', ['Apple iCloud']),
      makeCategory('memberships', 'Google Cloud', 'expense'),
    ],
  },
  {
    id: 'debt',
    name: 'Monthly Debt Payments',
    type: 'debt',
    sheetHeading: 'MONTHLY DEBT PAYMENTS',
    categories: [makeCategory('debt', 'Debt', 'debt')],
  },
  {
    id: 'savings',
    name: 'Monthly Savings',
    type: 'savings',
    sheetHeading: 'MONTHLY SAVINGS',
    categories: [
      makeCategory('savings', 'Joint Savings', 'savings'),
      makeCategory('savings', 'Joint Stocks', 'savings'),
      makeCategory('savings', 'Roth IRA Contributions', 'savings'),
    ],
  },
  {
    id: 'income',
    name: 'Monthly Income',
    type: 'income',
    sheetHeading: 'MONTHLY INCOME',
    categories: [
      makeCategory('income', 'Marcus After-Tax Income', 'income'),
      makeCategory('income', 'Alexa After-Tax Income', 'income'),
      makeCategory('income', 'Extra Income', 'income'),
    ],
  },
  {
    id: 'fun-money',
    name: 'Fun Money',
    type: 'allocation',
    sheetHeading: 'FUN MONEY',
    categories: [
      makeCategory('fun-money', 'Marcus Fun Money', 'allocation'),
      makeCategory('fun-money', 'Alexa Fun Money', 'allocation'),
    ],
  },
]

export const categories = categoryGroups.flatMap((group) => group.categories)

export const categoryById = Object.fromEntries(
  categories.map((category) => [category.id, category]),
)

export function buildCategoryGroups(
  customCategories = [],
  categoryNameOverrides = {},
) {
  return categoryGroups.map((group) => ({
    ...group,
    categories: [
      ...group.categories.map((category) => ({
        ...category,
        name: categoryNameOverrides[category.id] ?? category.name,
          aliases: categoryNameOverrides[category.id]
            ? [...(category.aliases ?? []), category.name]
            : category.aliases,
      })),
      ...customCategories
        .filter((category) => category.groupId === group.id)
        .map((category) => ({ ...category, isCustom: true })),
    ],
  }))
}
