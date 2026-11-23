import { describe, expect, it } from 'vitest'
import { serializeCsv } from './csvExport'

describe('serializeCsv', () => {
  it('quotes CSV delimiters and neutralizes spreadsheet formulas', () => {
    expect(serializeCsv([
      ['Description', 'Note'],
      ['Coffee, tea', '=SUM(A1:A2)'],
    ])).toBe('Description,Note\r\n"Coffee, tea",\'=SUM(A1:A2)')
  })

  it('escapes embedded quotes and line breaks', () => {
    expect(serializeCsv([['She said "hi"\nagain']]))
      .toBe('"She said ""hi""\nagain"')
  })
})
