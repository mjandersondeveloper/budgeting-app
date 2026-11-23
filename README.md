# Household Budget

A React + Vite household budgeting app. Phase 1 stores data in this browser only;
live sharing between devices and Firebase are planned for Phase 2.

## Phase 1 features

- Overview of monthly income, expenses and debt, savings, surplus/deficit,
  category budgets, equal fun-money allocation, and ending balance.
- Activity entry with date, description, amount, category, and optional note.
- Monthly plans for the workbook's category groups, with a reusable budget
  template for months that do not have their own override; add categories to
  budget groups or rename categories while keeping existing activity and
  budgets attached.
- Local CSV import of category budgets, plus CSV and JSON backup/exports.
- Responsive navigation and layouts for desktop, tablet, and phone.
- Dark appearance by default, with above-plan spending highlighted in red
  (income is not treated as overspending).

## Development

Requires Node.js 22+ and npm.

```sh
npm install
npm run dev
npm test
npm run lint
npm run build
```

The production build uses the GitHub Pages base path `/budgeting-app/`.

## Phase 1 data and privacy

- Budget and activity data are stored in this browser's local storage. They do
  not sync to another device or browser yet.
- Export the current workbook sheet as CSV, then import it from Settings. The
  CSV is parsed locally in the browser; it is not uploaded. The app imports
  the budget template only, not historical activity.
- Export and restore a full JSON backup before clearing site data or changing
  browsers.
- Do not commit the workbook or exported budget data to the repository.
- Budget amounts and activity records are not seeded in source code; import the
  worksheet's planned amounts from its CSV export on each device as needed.