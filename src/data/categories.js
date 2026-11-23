const makeCategory = (
  groupId,
  name,
  type,
  aliases = [],
  id = `${groupId}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
) => ({
  id,
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
      makeCategory('car', 'Car Payment', 'expense'),
    ],
  },
  {
    id: 'food-dining',
    name: 'Food & Dining',
    type: 'expense',
    sheetHeading: 'FOOD & DINING',
    sheetHeadingAliases: ['MONTHLY MISC'],
    categories: [
      makeCategory('food-dining', 'Restaurants/Bars', 'expense', [], 'monthly-misc:restaurants-bars'),
      makeCategory('food-dining', 'Costco', 'expense', [], 'monthly-misc:costco'),
      makeCategory('food-dining', 'Kroger/Giant Eagle', 'expense', [], 'monthly-misc:kroger-giant-eagle'),
    ],
  },
  {
    id: 'home-household',
    name: 'Home & Household',
    type: 'expense',
    sheetHeading: 'HOME & HOUSEHOLD',
    sheetHeadingAliases: ['MONTHLY MISC'],
    categories: [
      makeCategory('home-household', 'Home Fun Stuff', 'expense', [], 'monthly-misc:home-fun-stuff'),
      makeCategory('home-household', 'Home Improvement', 'expense', [], 'monthly-misc:home-improvement'),
      makeCategory('home-household', 'Home Furniture', 'expense', [], 'monthly-misc:home-furniture'),
    ],
  },
  {
    id: 'personal-lifestyle',
    name: 'Personal & Lifestyle',
    type: 'expense',
    sheetHeading: 'PERSONAL & LIFESTYLE',
    sheetHeadingAliases: ['MONTHLY MISC'],
    categories: [
      makeCategory('personal-lifestyle', 'Entertainment', 'expense', [], 'monthly-misc:entertainment'),
      makeCategory('personal-lifestyle', 'Toiletries/Personal Care', 'expense', [], 'monthly-misc:toiletries-personal-care'),
      makeCategory('personal-lifestyle', 'Miscellaneous/Shopping', 'expense', [], 'monthly-misc:miscellaneous-shopping'),
      makeCategory('personal-lifestyle', 'Gifts/Donations', 'expense', [], 'monthly-misc:gifts-donations'),
      makeCategory('personal-lifestyle', 'Healthcare', 'expense', ['Heathcare'], 'monthly-misc:healthcare'),
    ],
  },
  {
    id: 'travel',
    name: 'Travel',
    type: 'expense',
    sheetHeading: 'TRAVEL',
    sheetHeadingAliases: ['MONTHLY MISC'],
    categories: [
      makeCategory('travel', 'Travel', 'expense', [], 'monthly-misc:travel'),
    ],
  },
  {
    id: 'pets',
    name: 'Pets',
    type: 'expense',
    sheetHeading: 'PETS',
    sheetHeadingAliases: ['MONTHLY MISC'],
    categories: [
      makeCategory(
        'pets',
        'Motz Tax (Vet, Grooming, Food, etc.)',
        'expense',
        ['Motz Tax (Vet, Grooming, etc.)'],
        'monthly-misc:motz-tax-vet-grooming-food-etc',
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
    name: 'Debt Payments',
    type: 'debt',
    sheetHeading: 'MONTHLY DEBT PAYMENTS',
    categories: [
      makeCategory('debt', 'Other Debt Payment', 'debt', ['Debt'], 'debt:debt'),
    ],
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
