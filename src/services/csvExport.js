function escapeCsv(value) {
  const rawText = String(value ?? '')
  const text = /^[\t\r ]*[=+\-@]/.test(rawText) ? `'${rawText}` : rawText
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function serializeCsv(rows) {
  return rows
    .map((row) => row.map(escapeCsv).join(','))
    .join('\r\n')
}
