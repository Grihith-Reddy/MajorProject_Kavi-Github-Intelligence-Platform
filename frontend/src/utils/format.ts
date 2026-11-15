export function formatLineRange(start?: number | null, end?: number | null) {
  if (!start && !end) return 'Lines unknown'
  if (start && !end) return `Line ${start}`
  if (!start && end) return `Up to line ${end}`
  if (start === end) return `Line ${start}`
  return `Lines ${start}-${end}`
}

export function formatAsOf(value: string): string {
  const parsed = Date.parse(`${value}T12:00:00Z`)
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : value
}
