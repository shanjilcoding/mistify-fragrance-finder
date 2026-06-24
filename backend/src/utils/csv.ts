export type CsvRow = Record<string, string>

export function parseCsvLine(line: string) {
  const values: string[] = []
  let currentValue = ''
  let isInsideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"' && nextCharacter === '"') {
      currentValue += '"'
      index += 1
      continue
    }

    if (character === '"') {
      isInsideQuotes = !isInsideQuotes
      continue
    }

    if (character === ',' && !isInsideQuotes) {
      values.push(currentValue)
      currentValue = ''
      continue
    }

    currentValue += character
  }

  values.push(currentValue)

  return values.map((value) => value.trim())
}

export function parseCsv(csvContent: string, options: { lowercaseHeaders?: boolean } = {}): CsvRow[] {
  const lines = csvContent
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
  const headers = parseCsvLine(lines[0] ?? '').map((header) => {
    const trimmedHeader = header.trim()

    return options.lowercaseHeaders ? trimmedHeader.toLowerCase() : trimmedHeader
  })

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line)

    return headers.reduce<CsvRow>((row, header, index) => {
      row[header] = values[index] ?? ''
      return row
    }, {})
  })
}

export function requireCsvHeaders(headers: string[], requiredHeaders: string[]) {
  const normalizedHeaders = new Set(headers.map((header) => header.trim().toLowerCase()))
  const missingHeaders = requiredHeaders.filter(
    (header) => !normalizedHeaders.has(header.trim().toLowerCase()),
  )

  if (missingHeaders.length) {
    throw new Error(`CSV is missing required columns: ${missingHeaders.join(', ')}`)
  }
}

export function escapeCsvValue(value: string | number | null | undefined) {
  const stringValue = String(value ?? '')

  if (!/[",\r\n]/.test(stringValue)) {
    return stringValue
  }

  return `"${stringValue.replace(/"/g, '""')}"`
}

export function toCsv<T extends object>(headers: Array<keyof T>, rows: T[]) {
  return [
    headers.map(String).join(','),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvValue(row[header] as string | number | null | undefined))
        .join(','),
    ),
  ].join('\n')
}
