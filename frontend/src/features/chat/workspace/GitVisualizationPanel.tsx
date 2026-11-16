import { AlertCircle } from 'lucide-react'
import { type GitVisualizationPullRequest, type GitVisualizationResponse } from '../../../services/knowledgeService'

const GIT_LANE_COLORS = ['#22B8CF', '#F59F00', '#845EF7', '#2F9E44', '#FA5252', '#5C7CFA', '#E64980', '#0CA678']

export interface GitLane {
  branch: string
  x: number
  side: 'left' | 'center' | 'right'
  color: string
}

export interface GitGraphNode {
  id: string
  x: number
  y: number
  color: string
  branch: string
  prNumber: number | null
  merged: boolean
  kind: 'source' | 'target'
}

export interface GitGraphEdge {
  id: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  merged: boolean
}

export interface GitGraphLayout {
  width: number
  height: number
  lanes: GitLane[]
  nodes: GitGraphNode[]
  edges: GitGraphEdge[]
  mainBranch: string
}

function safeBranchName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim()
  return normalized || fallback
}

function toEpochMs(value: unknown): number {
  if (typeof value !== 'string' || !value.trim()) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildGitGraphLayout(pullRequests: GitVisualizationPullRequest[], defaultBranch: string | null | undefined): GitGraphLayout {
  const fallbackMain = safeBranchName(defaultBranch, 'main')
  const normalized = pullRequests.map((pr, index) => {
    const baseBranch = safeBranchName(pr.base_branch, fallbackMain)
    const headBranch = safeBranchName(pr.head_branch, baseBranch || fallbackMain)
    const eventAt = pr.event_at ?? pr.merged_at ?? pr.created_at ?? null
    return {
      index,
      baseBranch,
      headBranch,
      merged: Boolean(pr.merged_at),
      eventAt,
      createdAt: pr.created_at ?? null,
      prNumber: typeof pr.github_pr_number === 'number' ? pr.github_pr_number : null,
    }
  })

  if (!normalized.length) {
    return {
      width: 360,
      height: 280,
      lanes: [{ branch: fallbackMain, x: 180, side: 'center', color: GIT_LANE_COLORS[0] }],
      nodes: [],
      edges: [],
      mainBranch: fallbackMain,
    }
  }

  const branchCounts = new Map<string, number>()
  for (const pr of normalized) {
    branchCounts.set(pr.baseBranch, (branchCounts.get(pr.baseBranch) ?? 0) + 1)
    branchCounts.set(pr.headBranch, (branchCounts.get(pr.headBranch) ?? 0) + 1)
  }

  const fallbackBranch = Array.from(branchCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? fallbackMain
  const mainBranch = safeBranchName(defaultBranch, fallbackBranch)
  if (!branchCounts.has(mainBranch)) branchCounts.set(mainBranch, 1)

  const sideBranches = Array.from(branchCounts.entries())
    .map(([branch, count]) => ({ branch, count }))
    .filter((item) => item.branch !== mainBranch)
    .sort((a, b) => b.count - a.count || a.branch.localeCompare(b.branch))
    .map((item) => item.branch)

  const leftBranches: string[] = []
  const rightBranches: string[] = []
  sideBranches.forEach((branch, index) => {
    if (index % 2 === 0) leftBranches.push(branch)
    else rightBranches.push(branch)
  })

  const maxSideDepth = Math.max(leftBranches.length, rightBranches.length)
  const centerX = 180 + maxSideDepth * 94
  const graphWidth = Math.max(360, centerX * 2)
  const laneSpacing = 94

  const lanes: GitLane[] = [
    { branch: mainBranch, x: centerX, side: 'center', color: GIT_LANE_COLORS[0] },
    ...leftBranches.map((branch, index) => ({
      branch,
      x: centerX - laneSpacing * (index + 1),
      side: 'left' as const,
      color: GIT_LANE_COLORS[(index + 1) % GIT_LANE_COLORS.length],
    })),
    ...rightBranches.map((branch, index) => ({
      branch,
      x: centerX + laneSpacing * (index + 1),
      side: 'right' as const,
      color: GIT_LANE_COLORS[(leftBranches.length + index + 1) % GIT_LANE_COLORS.length],
    })),
  ]

  const laneByBranch = new Map(lanes.map((lane) => [lane.branch, lane]))
  const sorted = normalized.slice().sort((a, b) => {
    const aTime = toEpochMs(a.eventAt) || toEpochMs(a.createdAt) || a.index
    const bTime = toEpochMs(b.eventAt) || toEpochMs(b.createdAt) || b.index
    return aTime - bTime
  })

  const stepY = 56
  const height = Math.max(320, sorted.length * stepY + 120)
  const nodes: GitGraphNode[] = []
  const edges: GitGraphEdge[] = []

  sorted.forEach((pr, index) => {
    const headLane = laneByBranch.get(pr.headBranch) ?? laneByBranch.get(mainBranch)
    const baseLane = laneByBranch.get(pr.baseBranch) ?? laneByBranch.get(mainBranch)
    if (!headLane || !baseLane) return
    const y = height - 50 - index * stepY
    const prId = pr.prNumber ?? index

    nodes.push({
      id: `pr-${prId}-source-${index}`,
      x: headLane.x,
      y,
      color: headLane.color,
      branch: headLane.branch,
      prNumber: pr.prNumber,
      merged: pr.merged,
      kind: 'source',
    })

    if (headLane.branch !== baseLane.branch) {
      nodes.push({
        id: `pr-${prId}-target-${index}`,
        x: baseLane.x,
        y,
        color: baseLane.color,
        branch: baseLane.branch,
        prNumber: pr.prNumber,
        merged: pr.merged,
        kind: 'target',
      })
      edges.push({
        id: `edge-${prId}-${index}`,
        fromX: headLane.x,
        fromY: y,
        toX: baseLane.x,
        toY: y,
        merged: pr.merged,
      })
    }
  })

  return { width: graphWidth, height, lanes, nodes, edges, mainBranch }
}

export function GitVisualizationPanel({
  data,
  loading,
  error,
}: {
  data: GitVisualizationResponse | null
  loading: boolean
  error: Error | null
}) {
  if (loading) {
    return <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgb(var(--kv-ink-rgb) / 0.5)' }}>Loading branch graph...</p>
  }

  if (error) {
    return <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'var(--kv-danger-ink)', display: 'flex', alignItems: 'center', gap: 4 }}><AlertCircle size={12} /> Unable to load Git visualization.</p>
  }

  const pullRequests = Array.isArray(data?.pull_requests) ? data.pull_requests : []
  const defaultBranch = typeof data?.repository?.default_branch === 'string' ? data.repository.default_branch : 'main'
  const layout = buildGitGraphLayout(pullRequests, defaultBranch)

  if (!pullRequests.length) {
    return <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'rgb(var(--kv-ink-rgb) / 0.5)' }}>No pull requests are synced yet, so there is no branch graph to render.</p>
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ borderRadius: 16, border: '1px solid var(--kv-line)', background: 'var(--kv-mist-2)', padding: '10px 12px' }}>
        <p style={{ fontFamily: "'Gabarito', sans-serif", fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgb(var(--kv-ink-rgb) / 0.45)', marginBottom: 4 }}>Main branch</p>
        <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--kv-ink)' }}>{layout.mainBranch}</p>
      </div>

      <div style={{ borderRadius: 16, border: '1px solid var(--kv-line)', background: 'var(--kv-surface)', overflow: 'auto', maxHeight: '62vh' }}>
        <svg width={layout.width} height={layout.height} role="img" aria-label="Git branch visualization">
          {layout.lanes.map((lane) => (
            <g key={`lane-${lane.branch}`}>
              <line
                x1={lane.x}
                y1={28}
                x2={lane.x}
                y2={layout.height - 24}
                stroke={lane.side === 'center' ? 'rgb(var(--kv-ink-rgb) / 0.45)' : 'rgb(var(--kv-ink-rgb) / 0.18)'}
                strokeWidth={lane.side === 'center' ? 2.4 : 1.6}
              />
              <text
                x={lane.x}
                y={20}
                textAnchor="middle"
                style={{
                  fontFamily: "'Gabarito', sans-serif",
                  fontSize: 11,
                  fontWeight: lane.side === 'center' ? 700 : 500,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  fill: lane.side === 'center' ? 'var(--kv-ink)' : 'rgb(var(--kv-ink-rgb) / 0.6)',
                }}
              >
                {lane.branch}
              </text>
            </g>
          ))}

          {layout.edges.map((edge) => {
            const controlX = (edge.fromX + edge.toX) / 2
            const controlY = edge.fromY - 24
            return (
              <path
                key={edge.id}
                d={`M ${edge.fromX} ${edge.fromY} Q ${controlX} ${controlY} ${edge.toX} ${edge.toY}`}
                stroke={edge.merged ? 'rgb(var(--kv-ink-rgb) / 0.55)' : 'rgb(var(--kv-ink-rgb) / 0.3)'}
                strokeDasharray={edge.merged ? undefined : '4 5'}
                strokeWidth={edge.merged ? 1.8 : 1.4}
                fill="none"
              />
            )
          })}

          {layout.nodes.map((node) => (
            <g key={node.id}>
              <circle
                cx={node.x}
                cy={node.y}
                r={node.kind === 'source' ? 7 : 6}
                fill={node.kind === 'target' && !node.merged ? 'var(--kv-surface)' : node.color}
                stroke={node.color}
                strokeWidth={node.kind === 'target' && !node.merged ? 2.2 : 1.4}
              />
              {node.prNumber && node.kind === 'source' && (
                <text
                  x={node.x + 10}
                  y={node.y + 3}
                  style={{ fontFamily: "'Archivo', sans-serif", fontSize: 10, fill: 'rgb(var(--kv-ink-rgb) / 0.55)' }}
                >
                  #{node.prNumber}
                </text>
              )}
            </g>
          ))}

          <text
            x={18}
            y={layout.height / 2}
            transform={`rotate(-90 18 ${layout.height / 2})`}
            style={{
              fontFamily: "'Gabarito', sans-serif",
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              fill: 'rgb(var(--kv-ink-rgb) / 0.5)',
            }}
          >
            Time up
          </text>
        </svg>
      </div>
    </section>
  )
}
