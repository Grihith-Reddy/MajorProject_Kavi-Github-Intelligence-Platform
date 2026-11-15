// A small deterministic force-directed layout (no dependencies).
// Repulsion between all nodes, springs along weighted edges, gentle gravity to the
// centre and collision avoidance using each node's radius.

export interface LayoutNode { id: string; radius: number }
export interface LayoutEdge { source: string; target: string; weight: number }
export interface Point { x: number; y: number }

export function forceLayout(nodes: LayoutNode[], edges: LayoutEdge[], width: number, height: number, iterations = 360): Record<string, Point> {
  const positions: Record<string, Point> = {}
  const count = nodes.length
  if (!count) return positions
  const cx = width / 2
  const cy = height / 2
  // Golden-angle spiral start: deterministic and evenly spread.
  nodes.forEach((node, index) => {
    const angle = index * 2.399963
    const r = 30 + Math.sqrt(index / count) * Math.min(width, height) * 0.38
    positions[node.id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }
  })
  const radius = Object.fromEntries(nodes.map((node) => [node.id, node.radius]))
  const k = Math.sqrt((width * height) / count) * 0.62
  const validEdges = edges.filter((edge) => positions[edge.source] && positions[edge.target])

  for (let step = 0; step < iterations; step++) {
    const temperature = (1 - step / iterations) * 18 + 0.6
    const displacement: Record<string, Point> = {}
    for (const node of nodes) displacement[node.id] = { x: 0, y: 0 }

    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const a = nodes[i].id
        const b = nodes[j].id
        let dx = positions[a].x - positions[b].x
        let dy = positions[a].y - positions[b].y
        let distance = Math.hypot(dx, dy)
        if (distance < 0.01) { dx = 0.1 * (i - j); dy = 0.1; distance = 0.15 }
        const minDistance = radius[a] + radius[b] + 14
        const force = (k * k) / distance + (distance < minDistance ? (minDistance - distance) * 4 : 0)
        const fx = (dx / distance) * force
        const fy = (dy / distance) * force
        displacement[a].x += fx; displacement[a].y += fy
        displacement[b].x -= fx; displacement[b].y -= fy
      }
    }

    for (const edge of validEdges) {
      const a = positions[edge.source]
      const b = positions[edge.target]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const distance = Math.max(Math.hypot(dx, dy), 0.01)
      const force = ((distance * distance) / k) * (0.35 + edge.weight)
      const fx = (dx / distance) * force
      const fy = (dy / distance) * force
      displacement[edge.source].x -= fx; displacement[edge.source].y -= fy
      displacement[edge.target].x += fx; displacement[edge.target].y += fy
    }

    for (const node of nodes) {
      const p = positions[node.id]
      const d = displacement[node.id]
      d.x += (cx - p.x) * 0.9
      d.y += (cy - p.y) * 0.9
      const length = Math.max(Math.hypot(d.x, d.y), 0.01)
      p.x += (d.x / length) * Math.min(length, temperature)
      p.y += (d.y / length) * Math.min(length, temperature)
      p.x = Math.min(width - node.radius - 8, Math.max(node.radius + 8, p.x))
      p.y = Math.min(height - node.radius - 18, Math.max(node.radius + 8, p.y))
    }
  }
  return positions
}
