import type { WhySegment } from '../../services/insightsService'

// Pastel bands that read well on the dark code surface; same family as the card palette.
export const PR_COLORS = ['#73CEF2', '#C3B1F5', '#FFB59A', '#A9D18E', '#F7D774', '#8FD9D2', '#F2A7C3', '#B0C4F5']
export const COMMIT_COLOR = '#5B6670'
export const ROW_HEIGHT = 20

export function languageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = { py: 'python', ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'javascript', java: 'java', go: 'go', cs: 'csharp', sql: 'sql', kt: 'java', rb: 'python' }
  return map[ext] ?? 'typescript'
}

export function segmentKey(segment: WhySegment): string {
  return segment.pr_number ? `pr-${segment.pr_number}` : `c-${segment.commit_oid ?? segment.start_line}`
}
