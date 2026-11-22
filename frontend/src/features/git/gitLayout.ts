import type { GitExplorerCommit, GitExplorerPullRequest } from '../../services/knowledgeService'

/** Strong, distinct lane colours that read on both light and dark surfaces. */
export const LANE_COLORS = ['#15AEEA', '#F59F00', '#845EF7', '#2F9E44', '#E8590C', '#4C6EF5', '#D6336C', '#0CA678', '#AE3EC9', '#1C7ED6']

export const ROW_HEIGHT = 56
export interface GraphSpacing { gap: number; pad: number; maxLanes: number }
export const ROOMY: GraphSpacing = { gap: 20, pad: 18, maxLanes: 24 }
/** Phones: a narrow graph column so the pull-request rows keep most of the width. */
export const COMPACT: GraphSpacing = { gap: 9, pad: 10, maxLanes: 8 }

export type PrStatus = 'merged' | 'open' | 'closed'

export interface ExplorerPr extends GitExplorerPullRequest {
  status: PrStatus
  head: string
  base: string
  /** When the work started: first commit, else when the PR was opened. */
  startAt: number
  /** The row's moment: merge, close or last update. */
  eventAt: number
  commits: GitExplorerCommit[]
}

export interface LanePath {
  pr: ExplorerPr
  row: number
  lane: number
  baseLane: number
  color: string
  topY: number
  bottomY: number
  commitYs: number[]
}

export interface GraphLayout {
  rows: ExplorerPr[]
  paths: LanePath[]
  laneCount: number
  width: number
  laneX: (lane: number) => number
  height: number
  mainBranch: string
}

const time = (value: string | null | undefined) => {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const rowY = (row: number) => row * ROW_HEIGHT + ROW_HEIGHT / 2

export function prStatus(pr: GitExplorerPullRequest): PrStatus {
  if (pr.merged_at) return 'merged'
  return (pr.state ?? '').toLowerCase() === 'open' ? 'open' : 'closed'
}

/** Normalise pull requests and attach each one's commits, newest activity first. */
export function toExplorerPrs(prs: GitExplorerPullRequest[], commits: GitExplorerCommit[], mainBranch: string): ExplorerPr[] {
  const byPr = new Map<number, GitExplorerCommit[]>()
  for (const commit of commits) {
    if (commit.github_pr_number == null) continue
    const list = byPr.get(commit.github_pr_number) ?? []
    list.push(commit)
    byPr.set(commit.github_pr_number, list)
  }
  return prs
    .map((pr) => {
      const own = (byPr.get(pr.github_pr_number) ?? []).slice().sort((a, b) => time(a.committed_at) - time(b.committed_at))
      const base = (pr.base_branch ?? '').trim() || mainBranch
      const head = (pr.head_branch ?? '').trim() || `pr-${pr.github_pr_number}`
      const eventAt = time(pr.merged_at) || time(pr.updated_at) || time(pr.created_at)
      const startAt = Math.min(time(pr.first_commit_at) || Infinity, time(pr.created_at) || Infinity, eventAt || Infinity)
      return { ...pr, status: prStatus(pr), head, base, eventAt, startAt: Number.isFinite(startAt) ? startAt : eventAt, commits: own }
    })
    .sort((a, b) => b.eventAt - a.eventAt || b.github_pr_number - a.github_pr_number)
}

/**
 * Lay pull requests out as a git graph. Each row is one pull request (newest at the top). A
 * branch occupies a lane only between the row where its work started and the row where it was
 * merged or closed, and lanes are reused once free, so the graph stays narrow. Branch names are
 * never drawn inside the graph; they live in the row text beside it, so labels cannot collide.
 */
export function layoutGraph(rows: ExplorerPr[], mainBranch: string, spacing: GraphSpacing = ROOMY): GraphLayout {
  const laneX = (lane: number) => spacing.pad + lane * spacing.gap
  const height = Math.max(rows.length, 1) * ROW_HEIGHT
  // Row at which work on a PR began: the last row whose event is not older than the start time.
  const startRow = (pr: ExplorerPr, row: number) => {
    let index = row
    while (index + 1 < rows.length && rows[index + 1].eventAt >= pr.startAt) index += 1
    return index === rows.length - 1 && rows[index].eventAt > pr.startAt ? index + 0.6 : index + 0.45
  }

  type Interval = { row: number; top: number; bottom: number; pr: ExplorerPr }
  const intervals: Interval[] = rows.map((pr, row) => ({ row, top: row, bottom: Math.max(startRow(pr, row), row + 0.45), pr }))
  // Interval colouring: take branches top-down, give each the lowest lane free over its span.
  const laneBottoms: number[] = [] // index 0 is lane 1
  const laneOf = new Map<number, number>()
  intervals
    .slice()
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom)
    .forEach((interval) => {
      if (interval.pr.head === interval.pr.base) { laneOf.set(interval.row, 0); return }
      let lane = laneBottoms.findIndex((bottom) => bottom < interval.top - 0.15)
      if (lane === -1 && laneBottoms.length < spacing.maxLanes - 1) { lane = laneBottoms.length; laneBottoms.push(interval.bottom) }
      else if (lane === -1) {
        // Out of lanes (compact mode): share the lane that frees up soonest.
        lane = laneBottoms.reduce((best, bottom, i) => (bottom < laneBottoms[best] ? i : best), 0)
        laneBottoms[lane] = Math.max(laneBottoms[lane], interval.bottom)
      } else laneBottoms[lane] = interval.bottom
      laneOf.set(interval.row, lane + 1)
    })

  // A PR into a non-main branch merges into that branch's lane when it is active there.
  const activeLaneForBranch = (branch: string, row: number) => {
    if (branch === mainBranch) return 0
    const hit = intervals.find((i) => i.pr.head === branch && i.top <= row && i.bottom >= row)
    return hit ? laneOf.get(hit.row) ?? 0 : 0
  }

  const paths: LanePath[] = intervals.map((interval) => {
    const lane = laneOf.get(interval.row) ?? 0
    const topY = rowY(interval.top)
    const bottomY = Math.min(rowY(interval.bottom), height - 6)
    const span = Math.max(bottomY - topY - 22, 0)
    const count = interval.pr.commits.length
    const shown = Math.min(count, Math.floor(span / 7))
    const commitYs = Array.from({ length: shown }, (_, k) => bottomY - 11 - (shown === 1 ? span / 2 : (k * span) / Math.max(shown - 1, 1)))
    return {
      pr: interval.pr,
      row: interval.row,
      lane,
      baseLane: activeLaneForBranch(interval.pr.base, interval.row),
      color: lane === 0 ? 'var(--kv-ink)' : LANE_COLORS[(lane - 1) % LANE_COLORS.length],
      topY,
      bottomY,
      commitYs,
    }
  })

  const laneCount = laneBottoms.length + 1
  return { rows, paths, laneCount, width: laneX(laneCount - 1) + spacing.pad, laneX, height, mainBranch }
}

/** Branch summaries for the Branches tab. */
export interface BranchSummary {
  name: string
  targets: string[]
  prs: number
  commits: number
  status: PrStatus
  firstAt: number
  lastAt: number
}

export function summariseBranches(rows: ExplorerPr[]): BranchSummary[] {
  const map = new Map<string, BranchSummary>()
  for (const pr of rows) {
    const current = map.get(pr.head) ?? { name: pr.head, targets: [], prs: 0, commits: 0, status: pr.status, firstAt: pr.startAt, lastAt: pr.eventAt }
    current.prs += 1
    current.commits += pr.commit_count || pr.commits.length
    if (!current.targets.includes(pr.base)) current.targets.push(pr.base)
    if (pr.eventAt >= current.lastAt) { current.lastAt = pr.eventAt; current.status = pr.status }
    current.firstAt = Math.min(current.firstAt, pr.startAt)
    map.set(pr.head, current)
  }
  return Array.from(map.values()).sort((a, b) => b.lastAt - a.lastAt)
}

/** People: pull requests authored, reviews and comments, newest activity first. */
export interface PersonSummary {
  login: string
  authored: number
  reviewed: number
  commented: number
  lastAt: number
}

export function summarisePeople(rows: ExplorerPr[]): PersonSummary[] {
  const map = new Map<string, PersonSummary>()
  const get = (login: string) => {
    const item = map.get(login) ?? { login, authored: 0, reviewed: 0, commented: 0, lastAt: 0 }
    map.set(login, item)
    return item
  }
  for (const pr of rows) {
    if (pr.author_login) { const p = get(pr.author_login); p.authored += 1; p.lastAt = Math.max(p.lastAt, pr.eventAt) }
    for (const person of pr.participants ?? []) {
      if (person.role === 'author') continue
      const p = get(person.login)
      if (person.role === 'reviewer') p.reviewed += 1
      else p.commented += 1
      p.lastAt = Math.max(p.lastAt, pr.eventAt)
    }
  }
  return Array.from(map.values()).sort((a, b) => b.authored + b.reviewed + b.commented - (a.authored + a.reviewed + a.commented))
}

/** Pull requests opened and merged per month, oldest first. */
export function monthlyActivity(rows: ExplorerPr[]) {
  const map = new Map<string, { month: string; opened: number; merged: number }>()
  const key = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
  const bump = (ms: number, field: 'opened' | 'merged') => {
    if (!ms) return
    const k = key(ms)
    const item = map.get(k) ?? { month: k, opened: 0, merged: 0 }
    item[field] += 1
    map.set(k, item)
  }
  for (const pr of rows) {
    bump(time(pr.created_at), 'opened')
    if (pr.status === 'merged') bump(time(pr.merged_at), 'merged')
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month))
}
