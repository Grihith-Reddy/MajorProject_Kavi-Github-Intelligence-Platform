import * as React from 'react'

/**
 * Pushpin tear footer (adapted from 21st.dev "Pushpin Tear Footer" by kedhareswer).
 * A coloured sheet carries the footer's chrome; its bottom has been ripped away from a glossy
 * pushpin, and the brand is printed on the paper underneath. When it scrolls in, the chrome
 * assembles, the pin drops and the sheet rips outwards from it; click the pin to re-rip.
 *
 * KAVI changes: no newsletter or email (they had nowhere to go) — a call to action and a slot
 * for an action at the top instead; links can scroll to sections or route inside the app; the
 * clock shows the visitor's own time; colours come from the KAVI theme (day and night).
 * The tear geometry, flaps, grain and pin are unchanged: SVG and canvas built from numbers.
 */

// #region tear (unchanged from the original)
type Flap = { at: number; span: number; len: number; skew: number; dir: number; jag: number[] }
type Tear = { ys: number[]; rim: number[]; lag: number[]; flaps: Flap[] }

const RIDGE_N = 84
const START = 1.06
const FLAPS = 6

const clamp01 = (v: number) => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0)

function rng(seed: number) {
  let a = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const XS: number[] = (() => {
  const r = rng(911)
  const out: number[] = []
  for (let i = 0; i < RIDGE_N; i++) {
    const u = i / (RIDGE_N - 1)
    const j = i > 0 && i < RIDGE_N - 1 ? (r() - 0.5) * (0.8 / RIDGE_N) : 0
    out.push(-0.02 + u * 1.04 + j)
  }
  return out
})()

function ridgeFloor(x: number) {
  const d = Math.abs(x - 0.5)
  if (d < 0.13) return 0.39
  if (d < 0.25) return 0.43
  return 0.5
}

function makeTear(seed: number, n = RIDGE_N): Tear {
  const r = rng(seed)
  const ph = [r() * 6.283, r() * 6.283, r() * 6.283]
  const ys: number[] = []
  const rim: number[] = []
  const lag: number[] = []
  for (let i = 0; i < n; i++) {
    const x = XS[Math.min(i, XS.length - 1)]
    const d = Math.min(1, Math.abs(x - 0.5) * 2)
    const base = 0.43 + 0.3 * Math.pow(d, 1.35)
    const wander = (0.022 * Math.sin(x * 7 + ph[0]) + 0.016 * Math.sin(x * 13 + ph[1]) + 0.01 * Math.sin(x * 29 + ph[2])) * (0.45 + 0.55 * d)
    const spike = r() < 0.16 ? 2.3 : 1
    const jag = (r() - 0.5) * 0.022 * spike
    ys.push(Math.min(0.8, Math.max(ridgeFloor(x), base + wander + jag)))
    rim.push(1.2 + r() * 3.6)
    lag.push(Math.min(0.48, d * 0.4 + 0.04 + 0.03 * Math.sin(x * 23 + ph[1]) + r() * 0.012))
  }
  const slots = [0.05, 0.19, 0.33, 0.67, 0.81, 0.95]
  const up = r() < 0.5 ? [2, 4] : [1, 3]
  const flaps: Flap[] = slots.map((slot, k) => {
    const x = slot + (r() - 0.5) * 0.05
    const span = 3 + Math.floor(r() * 5)
    const at = Math.max(0, Math.min(n - 1 - span, Math.round(x * (n - 1))))
    const dir = up.includes(k) ? -1 : 1
    const outer = k === 0 || k === slots.length - 1
    const len = dir < 0 ? 0.022 + r() * 0.022 : outer ? 0.085 + r() * 0.04 : 0.045 + r() * 0.05
    return { at, span, len, skew: (r() - 0.5) * 1.1, dir, jag: [r() - 0.5, r() - 0.5, r() - 0.5, r() - 0.5] }
  })
  return { ys, rim, lag, flaps }
}

function easeTear(t: number) {
  const x = clamp01(t)
  if (x === 0 || x === 1) return x
  const c1 = 0.9
  return 1 + (c1 + 1) * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

const easeInOut = (t: number) => {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

function introYs(tear: Tear, t: number) {
  return tear.ys.map((y, i) => START + (y - START) * easeTear((t - tear.lag[i]) / 0.5))
}

function morphYs(from: number[], to: Tear, t: number) {
  return to.ys.map((y, i) => {
    const a = from[i] ?? y
    return a + (y - a) * easeInOut((t - to.lag[i] * 0.6) / 0.6)
  })
}

function flapOpen(tear: Tear, f: Flap, t: number) {
  return easeTear((t - tear.lag[f.at] - 0.18) / 0.32)
}

function flapPoly(ys: number[], f: Flap, W: number, H: number, open: number) {
  const b = Math.min(ys.length - 1, f.at + f.span)
  const top: number[][] = []
  for (let k = f.at; k <= b; k++) top.push([XS[k] * W, ys[k] * H])
  const A = top[0]
  const B = top[top.length - 1]
  const mx = (A[0] + B[0]) / 2
  const my = (A[1] + B[1]) / 2
  const L = f.len * H * Math.max(0, open)
  const tip = [mx + f.skew * L, my + f.dir * L]
  const side = (Pt: number[], Q: number[], j0: number, j1: number) => {
    const dx = Q[0] - Pt[0]
    const dy = Q[1] - Pt[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    return [
      [Pt[0] + dx / 3 + nx * j0 * 0.22 * L, Pt[1] + dy / 3 + ny * j0 * 0.22 * L],
      [Pt[0] + (dx * 2) / 3 + nx * j1 * 0.22 * L, Pt[1] + (dy * 2) / 3 + ny * j1 * 0.22 * L],
    ]
  }
  return [...top, ...side(B, tip, f.jag[0], f.jag[1]), tip, ...side(tip, A, f.jag[2], f.jag[3])]
}

const n1 = (v: number) => Math.round(v * 10) / 10

function polyD(pts: number[][]) {
  return pts.length ? 'M' + pts.map((p) => n1(p[0]) + ' ' + n1(p[1])).join('L') + 'Z' : ''
}

function sheetD(ys: number[], W: number, H: number, off?: number[]) {
  let d = 'M-20 -20L' + (W + 20) + ' -20'
  for (let i = ys.length - 1; i >= 0; i--) d += 'L' + n1(XS[i] * W) + ' ' + n1(ys[i] * H - (off ? off[i] : 0))
  return d + 'Z'
}

function mixHex(a: string, b: string, t: number) {
  const p = (h: string) => {
    const s = h.replace('#', '')
    const f = s.length === 3 ? s.split('').map((c) => c + c).join('') : s.padEnd(6, '0').slice(0, 6)
    return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0)
  }
  const x = p(a)
  const y = p(b)
  const k = clamp01(t)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, '0')).join('')
}
// #endregion

type IconName = 'github' | 'shield' | 'doc' | 'spark' | 'chevL' | 'arrow' | 'squiggle'

export type TearLink = { label: string; href: string }
export type IconLink = { icon: IconName; label: string; href: string }
export type FooterColumn = { title: string; links: TearLink[]; cta?: TearLink }

export type TearFooterProps = {
  brand: string
  name: string
  logo: React.ReactNode
  logoHref: string
  socials: IconLink[]
  /** Replaces the original's copy-email button at the top right. */
  topAction?: React.ReactNode
  /** Replaces the original's newsletter: a label over a pill button. */
  cta?: { label: string; button: string; onClick: () => void } | null
  status?: { label: string } | null
  mark?: string
  timeLabel?: string
  columns: FooterColumn[]
  chat?: TearLink | null
  sideLinks: IconLink[]
  copyright: string
  credit?: string
  handle?: TearLink
  sheet: string
  paper: string
  sheetInk: string
  paperInk: string
  seed?: number
  fontSans?: string
  /** In-page anchors (#id) and in-app routes (/path) go through these instead of a full navigation. */
  onAnchor?: (id: string) => void
  onRoute?: (path: string) => void
}

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function Icon({ name }: { name: IconName }) {
  const svg = (children: React.ReactNode, filled?: boolean) => (
    <svg viewBox="0 0 24 24" className="tpf-ico" aria-hidden="true" {...(filled ? { fill: 'currentColor' } : STROKE)}>
      {children}
    </svg>
  )
  switch (name) {
    case 'chevL': return svg(<path d="M14.5 5.5 8 12l6.5 6.5" />)
    case 'arrow': return svg(<path d="M5 12h13M13 6.5 18.5 12 13 17.5" />)
    case 'squiggle': return svg(<path d="M3.5 15c1.8-3.2 3.6-3.2 5.4 0s3.6 3.2 5.4 0 3.6-3.2 5.4 0" />)
    case 'github':
      return svg(<path fillRule="evenodd" d="M12 2.8a9.3 9.3 0 0 0-2.9 18.1c.5.1.6-.2.6-.5v-1.7c-2.6.6-3.1-1.1-3.1-1.1-.4-1.1-1-1.4-1-1.4-.9-.6.1-.6.1-.6.9.1 1.4 1 1.4 1 .8 1.4 2.2 1 2.7.8.1-.6.3-1 .6-1.2-2.1-.2-4.2-1-4.2-4.6 0-1 .4-1.8 1-2.5-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.6 1a8.8 8.8 0 0 1 4.6 0c1.8-1.2 2.6-1 2.6-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.5 1 2.5 0 3.6-2.2 4.4-4.2 4.6.3.3.6.8.6 1.6v2.4c0 .3.2.6.7.5A9.3 9.3 0 0 0 12 2.8z" />, true)
    case 'doc': return svg(<><path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" /><path d="M14 3.5V8h4.5M8.8 12.5h6.4M8.8 16h4.2" /></>)
    case 'spark': return svg(<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.6 2.6M15.4 15.4 18 18M18 6l-2.6 2.6M8.6 15.4 6 18" />)
    case 'shield':
      return svg(<path fillRule="evenodd" d="M6.5 2.5h11a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4h-11a4 4 0 0 1-4-4v-11a4 4 0 0 1 4-4zM12 6.2 7.6 7.8v3.6c0 2.9 1.9 5.2 4.4 6.2 2.5-1 4.4-3.3 4.4-6.2V7.8zm-2 5.8 1.4 1.4 2.8-2.9" />, true)
  }
}

function Seal() {
  let d = ''
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 ? 8.6 : 10
    d += (i ? 'L' : 'M') + (12 + Math.cos(a) * r).toFixed(2) + ' ' + (12 + Math.sin(a) * r).toFixed(2)
  }
  return (
    <svg viewBox="0 0 24 24" className="tpf-seal" aria-hidden="true">
      <path d={d + 'Z'} fill="currentColor" strokeLinejoin="round" stroke="currentColor" strokeWidth="2.2" />
      <path d="m8.3 12.2 2.5 2.5 5-5.2" fill="none" stroke="var(--tpf-sheet)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The visitor's own local time, with a blinking colon. */
function Clock({ label }: { label: string }) {
  const [t, setT] = React.useState(['--', '--'])
  React.useEffect(() => {
    const f = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const tick = () => setT(f.format(new Date()).split(':'))
    tick()
    const id = window.setInterval(tick, 10000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="tpf-clock">
      {label} {t[0]}
      <i aria-hidden="true">:</i>
      {t[1]}
    </span>
  )
}

function Pin({ base, id }: { base: string; id: string }) {
  const hi = mixHex(base, '#ffffff', 0.62)
  const mid = base
  const lo = mixHex(base, '#000000', 0.42)
  const deep = mixHex(base, '#000000', 0.66)
  const t = { transition: 'stop-color .7s ease' }
  const side = (gid: string) => (
    <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" style={{ ...t, stopColor: lo }} />
      <stop offset=".24" style={{ ...t, stopColor: mid }} />
      <stop offset=".4" style={{ ...t, stopColor: hi }} />
      <stop offset=".58" style={{ ...t, stopColor: mid }} />
      <stop offset="1" style={{ ...t, stopColor: deep }} />
    </linearGradient>
  )
  return (
    <svg viewBox="0 0 100 200" className="tpf-pin-svg" aria-hidden="true">
      <defs>
        {side(id + 's')}
        <radialGradient id={id + 't'} cx=".38" cy=".3" r=".8">
          <stop offset="0" style={{ ...t, stopColor: hi }} />
          <stop offset=".55" style={{ ...t, stopColor: mid }} />
          <stop offset="1" style={{ ...t, stopColor: lo }} />
        </radialGradient>
        <linearGradient id={id + 'n'} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#5b616b" />
          <stop offset=".4" stopColor="#f4f5f7" />
          <stop offset=".7" stopColor="#a3a9b2" />
          <stop offset="1" stopColor="#4a4f57" />
        </linearGradient>
        <filter id={id + 'b'} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>
      <path d="M48.3 112h3.4l-.7 76-1 4-1-4z" fill={'url(#' + id + 'n)'} />
      <ellipse cx="50" cy="191.5" rx="3.2" ry="1.1" fill="#0b1a33" opacity=".35" />
      <path d="M28 103v6.5a22 7 0 0 0 44 0V103z" fill={'url(#' + id + 's)'} />
      <ellipse cx="50" cy="103" rx="22" ry="7" fill={'url(#' + id + 't)'} />
      <path d="M41.5 38c1.6 16 4.6 26 3 36-1.8 10-13 19-14.6 29h40.2c-1.6-10-12.8-19-14.6-29-1.6-10 1.4-20 3-36z" fill={'url(#' + id + 's)'} />
      <path d="M16 22v14a34 13 0 0 0 68 0V22z" fill={'url(#' + id + 's)'} />
      <ellipse cx="50" cy="22" rx="34" ry="13" fill={'url(#' + id + 't)'} />
      <ellipse cx="50" cy="22" rx="33" ry="12.3" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth=".8" />
      <ellipse cx="37" cy="17.5" rx="12" ry="4" fill="#fff" opacity=".7" filter={'url(#' + id + 'b)'} />
      <path d="M22 38c4 4.5 9.5 6.4 15 7" stroke="#fff" strokeOpacity=".35" strokeWidth="2" fill="none" strokeLinecap="round" filter={'url(#' + id + 'b)'} />
      <path d="M45 50c.8 8 1.6 14 .8 22" stroke="#fff" strokeOpacity=".45" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function useReducedMotion() {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onMq = () => setReduced(mq.matches)
    onMq()
    mq.addEventListener('change', onMq)
    return () => mq.removeEventListener('change', onMq)
  }, [])
  return reduced
}

export function TearFooter({
  brand, name, logo, logoHref, socials, topAction, cta, status, mark, timeLabel = 'Your time',
  columns, chat, sideLinks, copyright, credit, handle, sheet, paper, sheetInk, paperInk,
  seed = 7, fontSans = "'Archivo', system-ui, sans-serif", onAnchor, onRoute,
}: TearFooterProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '')
  const rootRef = React.useRef<HTMLElement>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const sheetRef = React.useRef<SVGPathElement>(null)
  const rimRef = React.useRef<SVGPathElement>(null)
  const flapRefs = React.useRef<(SVGPathElement | null)[]>([])
  const gradRefs = React.useRef<(SVGLinearGradientElement | null)[]>([])
  const pinRef = React.useRef<HTMLButtonElement>(null)
  const timers = React.useRef<number[]>([])

  const still = useReducedMotion()
  const [stage, setStage] = React.useState(0)
  const [hit, setHit] = React.useState(false)
  const [visible, setVisible] = React.useState(false)
  const [pin, setPin] = React.useState<'idle' | 'lift' | 'stab'>('idle')
  const [grain, setGrain] = React.useState('')
  const [finePointer, setFinePointer] = React.useState(false)

  const s = React.useRef({
    W: 0, H: 0, tear: makeTear(seed), prev: null as Tear | null, from: [] as number[], ys: [] as number[],
    mode: 'wait' as 'wait' | 'intro' | 'morph' | 'rest', t0: 0, dur: 1, raf: 0, px: -1e4, py: -1e4,
    lift: new Array(FLAPS).fill(0) as number[], still: false, busy: false, seed,
  }).current
  s.still = still

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  React.useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const on = () => setFinePointer(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // ---- drawing (unchanged): only runs while something is moving ----
  const frame = React.useCallback((now: number) => {
    s.raf = 0
    const { W, H, tear } = s
    if (!W || !H) return
    let busy = false
    let ys: number[]
    const open = new Array(FLAPS).fill(1)
    const openOld = new Array(FLAPS).fill(0)
    if (s.mode === 'wait') {
      ys = tear.ys.map(() => START)
      open.fill(0)
    } else if (s.mode === 'intro') {
      const p = (now - s.t0) / s.dur
      ys = introYs(tear, Math.min(1, p))
      tear.flaps.forEach((f, k) => (open[k] = flapOpen(tear, f, Math.min(1, p))))
      if (p >= 1) s.mode = 'rest'
      else busy = true
    } else if (s.mode === 'morph') {
      const p = (now - s.t0) / s.dur
      ys = morphYs(s.from, tear, Math.min(1, p))
      open.fill(easeTear((p - 0.5) / 0.5))
      openOld.fill(1 - easeInOut(p / 0.35))
      if (p >= 1) s.mode = 'rest'
      else busy = true
    } else ys = tear.ys
    s.ys = ys

    tear.flaps.forEach((f, k) => {
      const b = Math.min(ys.length - 1, f.at + f.span)
      const mx = ((XS[f.at] + XS[b]) / 2) * W
      const my = ((ys[f.at] + ys[b]) / 2) * H
      const target = s.still ? 0 : clamp01(1 - Math.hypot(s.px - mx, s.py - my) / (0.2 * Math.max(W, 520)))
      s.lift[k] += (target - s.lift[k]) * 0.14
      if (Math.abs(target - s.lift[k]) > 0.003) busy = true
      open[k] *= 1 + 0.32 * s.lift[k]
    })

    sheetRef.current?.setAttribute('d', sheetD(ys, W, H, tear.rim))
    rimRef.current?.setAttribute('d', sheetD(ys, W, H))
    const draw = (k: number, f: Flap | undefined, o: number) => {
      const el = flapRefs.current[k]
      const g = gradRefs.current[k]
      if (!el || !g) return
      if (!f || o < 0.01) return el.setAttribute('d', '')
      const pts = flapPoly(ys, f, W, H, o)
      el.setAttribute('d', polyD(pts))
      const b = Math.min(ys.length - 1, f.at + f.span)
      const tip = pts[f.span + 3]
      g.setAttribute('x1', String(((XS[f.at] + XS[b]) / 2) * W))
      g.setAttribute('y1', String(((ys[f.at] + ys[b]) / 2) * H))
      g.setAttribute('x2', String(tip[0]))
      g.setAttribute('y2', String(tip[1]))
    }
    for (let k = 0; k < FLAPS; k++) {
      draw(k, tear.flaps[k], open[k])
      draw(FLAPS + k, s.prev?.flaps[k], openOld[k])
    }
    if (busy) s.raf = requestAnimationFrame(frame)
  }, [s])

  const kick = React.useCallback(() => {
    if (!s.raf) s.raf = requestAnimationFrame(frame)
  }, [s, frame])

  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      s.W = el.clientWidth
      s.H = el.clientHeight
      const svg = svgRef.current
      if (svg) {
        svg.setAttribute('width', String(s.W))
        svg.setAttribute('height', String(s.H))
        svg.setAttribute('viewBox', '0 0 ' + s.W + ' ' + s.H)
      }
      kick()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(s.raf)
      s.raf = 0
    }
  }, [s, kick])

  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.22 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  React.useEffect(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 160
    const g = c.getContext('2d')
    if (!g) return
    const img = g.createImageData(160, 160)
    const r = rng(42)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = r() < 0.5 ? 0 : 255
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v
      img.data[i + 3] = Math.floor(r() * 46)
    }
    g.putImageData(img, 0, 0)
    setGrain(c.toDataURL())
  }, [])

  React.useEffect(() => {
    if (!visible || stage > 0) return
    if (still) {
      setStage(3)
      s.mode = 'rest'
      kick()
      return
    }
    setStage(1)
    later(() => setStage(2), 640)
    later(() => {
      setHit(true)
      setStage(3)
      s.mode = 'intro'
      s.t0 = performance.now()
      s.dur = 1550
      kick()
    }, 1140)
    later(() => setHit(false), 1480)
  }, [visible, stage, still, s, kick])

  React.useEffect(() => () => { timers.current.forEach((id) => clearTimeout(id)) }, [])

  // ---- actions ----
  // Flaps lift towards a mouse only; on touch screens the pointer would leave them stuck mid-lift.
  const onPointerMove = (e: React.PointerEvent) => {
    const el = rootRef.current
    if (!el || s.still || !finePointer || e.pointerType !== 'mouse') return
    const r = el.getBoundingClientRect()
    s.px = e.clientX - r.left
    s.py = e.clientY - r.top
    const tilt = Math.max(-9, Math.min(9, (s.px / r.width - 0.5) * 18))
    pinRef.current?.style.setProperty('--tilt', tilt.toFixed(2) + 'deg')
    kick()
  }
  const onPointerLeave = () => {
    s.px = s.py = -1e4
    pinRef.current?.style.setProperty('--tilt', '0deg')
    kick()
  }

  const repin = () => {
    if (s.busy || stage < 3) return
    const next = s.seed + 1
    const swap = () => {
      s.seed = next
      s.prev = s.tear
      s.from = s.ys.length ? s.ys : s.tear.ys
      s.tear = makeTear(next)
    }
    if (still) {
      swap()
      s.prev = null
      s.mode = 'rest'
      kick()
      return
    }
    s.busy = true
    setPin('lift')
    later(() => {
      swap()
      s.mode = 'morph'
      s.t0 = performance.now()
      s.dur = 1150
      kick()
    }, 300)
    later(() => setPin('stab'), 1280)
    later(() => {
      setPin('idle')
      s.busy = false
    }, 1720)
  }

  const toTop = () => window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' })

  const A = ({ href, className, label, children, style }: { href: string; className?: string; label?: string; children: React.ReactNode; style?: React.CSSProperties }) => {
    const external = /^https?:/.test(href)
    const onClick = (e: React.MouseEvent) => {
      if (href.startsWith('#') && onAnchor) { e.preventDefault(); onAnchor(href.slice(1)) }
      else if (href.startsWith('/') && onRoute) { e.preventDefault(); onRoute(href) }
    }
    return (
      <a href={href} className={className} aria-label={label} title={label} onClick={onClick} style={style} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {children}
      </a>
    )
  }

  const pinBase = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(sheet) ? sheet : '#15aeea'
  const flapBase = mixHex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(paper) ? paper : '#f3f3f1', '#ffffff', 0.35)
  const vars = {
    '--tpf-sheet': sheet,
    '--tpf-paper': paper,
    '--tpf-on-sheet': sheetInk,
    '--tpf-on-paper': paperInk,
    '--tpf-rim': mixHex(flapBase, '#ffffff', 0.6),
    '--tpf-sans': fontSans,
  } as React.CSSProperties

  const H = (i: number) => ({ '--i': i }) as React.CSSProperties
  const cls = ['tpf', stage >= 1 && 's1', stage >= 2 && 's2', stage >= 3 && 's3', hit && 'is-hit'].filter(Boolean).join(' ')

  return (
    <footer ref={rootRef} className={cls} style={vars} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
      <svg ref={svgRef} className="tpf-stage" aria-hidden="true">
        <defs>
          <radialGradient id={uid + 'v'} cx=".5" cy=".78" r=".75">
            <stop offset=".45" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#0d1c38" stopOpacity=".07" />
          </radialGradient>
          <linearGradient id={uid + 'l'} x1="0" y1="0" x2=".35" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".13" />
            <stop offset=".55" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#001033" stopOpacity=".12" />
          </linearGradient>
          {grain && (
            <pattern id={uid + 'g'} width="160" height="160" patternUnits="userSpaceOnUse">
              <image href={grain} width="160" height="160" />
            </pattern>
          )}
          <filter id={uid + 'd'} x="-5%" y="-5%" width="110%" height="120%">
            <feDropShadow dx="0" dy="3" stdDeviation="3.5" floodColor="#0a1a3a" floodOpacity=".3" />
          </filter>
          <filter id={uid + 'f'} x="-30%" y="-30%" width="160%" height="170%">
            <feDropShadow dx="-2" dy="4" stdDeviation="4" floodColor="#0a1a3a" floodOpacity=".26" />
          </filter>
          {Array.from({ length: FLAPS * 2 }, (_, k) => (
            <linearGradient key={k} id={uid + 'fg' + k} ref={(el) => { gradRefs.current[k] = el }} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={mixHex(flapBase, '#1c2a44', 0.34)} />
              <stop offset=".5" stopColor={mixHex(flapBase, '#1c2a44', 0.08)} />
              <stop offset="1" stopColor={mixHex(flapBase, '#ffffff', 0.5)} />
            </linearGradient>
          ))}
          <path id={uid + 's'} ref={sheetRef} />
        </defs>
        <rect className="tpf-paper" width="100%" height="100%" />
        <rect width="100%" height="100%" fill={'url(#' + uid + 'v)'} style={{ mixBlendMode: 'multiply' }} />
        {grain && <rect width="100%" height="100%" fill={'url(#' + uid + 'g)'} opacity=".32" />}
        <g className="tpf-sheet-g" filter={'url(#' + uid + 'd)'}>
          <path ref={rimRef} className="tpf-rim" />
          <use href={'#' + uid + 's'} className="tpf-sheet" />
        </g>
        <use href={'#' + uid + 's'} fill={'url(#' + uid + 'l)'} />
        {grain && <use href={'#' + uid + 's'} fill={'url(#' + uid + 'g)'} opacity=".5" />}
        <g filter={'url(#' + uid + 'f)'}>
          {Array.from({ length: FLAPS * 2 }, (_, k) => (
            <path key={k} ref={(el) => { flapRefs.current[k] = el }} fill={'url(#' + uid + 'fg' + k + ')'} />
          ))}
        </g>
      </svg>

      {/* ---- on the sheet ---- */}
      <div className="tpf-z tpf-top">
        <div className="tpf-row tpf-h" style={H(0)}>
          <button type="button" className="tpf-ib tpf-up" onClick={toTop} aria-label="Back to top" title="Back to top">
            <Icon name="chevL" />
          </button>
          <span style={{ width: '.6em' }} />
          {socials.map((l, i) => (
            <A key={i} href={l.href} className="tpf-ib" label={l.label}>
              <Icon name={l.icon} />
            </A>
          ))}
        </div>
        <A href={logoHref} className="tpf-logo tpf-h" label={name + ', home'} style={H(1)}>
          {logo}
        </A>
        <div className="tpf-h tpf-top-action" style={H(2)}>{topAction}</div>
      </div>

      {cta && (
        <div className="tpf-z tpf-news tpf-h" style={H(3)}>
          <span>{cta.label}</span>
          <button type="button" className="tpf-pill" onClick={cta.onClick}>
            <span className="tpf-pill-text">{cta.button}</span>
            <span className="tpf-knob" aria-hidden="true"><Icon name="arrow" /></span>
          </button>
        </div>
      )}

      {mark && <span className="tpf-z tpf-flank tpf-h" style={{ ...H(4), left: '24%' }}>{mark}</span>}
      <span className="tpf-z tpf-flank tpf-h" style={{ ...H(4), left: '76%' }} title="Your local time">
        <Clock label={timeLabel} />
      </span>

      {status && (
        <>
          <span className="tpf-z tpf-status tpf-h" style={H(5)}>
            <i className="tpf-live" aria-hidden="true" />
            <span>{status.label}</span>
          </span>
          <span className="tpf-z tpf-badge" aria-hidden="true">
            <span className="tpf-h" style={{ ...H(6), display: 'block', width: '100%', height: '100%' }}>
              <Seal />
            </span>
          </span>
        </>
      )}

      {columns.slice(0, 2).map((c, i) => (
        <nav key={i} className={'tpf-z tpf-col tpf-h ' + (i ? 'r' : 'l')} style={H(6 + i)} aria-label={c.title}>
          <h3>
            {c.title}
            <Icon name="squiggle" />
          </h3>
          <ul>
            {c.links.map((l, j) => (
              <li key={j}>
                <A href={l.href}>{l.label}</A>
              </li>
            ))}
          </ul>
          {c.cta && <A href={c.cta.href} className="tpf-big">{c.cta.label}</A>}
        </nav>
      ))}

      {/* ---- the pin ---- */}
      <button ref={pinRef} type="button" className="tpf-pin" data-pin={pin} onClick={repin} aria-label="Re-pin: tear a new edge" title="Pull the pin">
        <span className="tpf-shadow" aria-hidden="true" />
        <span className="tpf-tilt">
          <span className="tpf-drop">
            <span className="tpf-body">
              <Pin base={pinBase} id={uid + 'p'} />
            </span>
          </span>
        </span>
      </button>

      {/* ---- printed on the paper ---- */}
      <div className="tpf-z tpf-brand tpf-ink">
        <div className="tpf-brand-top tpf-p" style={H(0)}>
          <span className="tpf-eye">{name}</span>
          {chat && (
            <A href={chat.href} className="tpf-bub" label={chat.label}>
              <span className="tpf-dots" aria-hidden="true"><i /><i /><i /></span>
              <b>{chat.label}</b>
            </A>
          )}
        </div>
        <A href={logoHref} className="tpf-word" label={name}>
          <span>{brand}</span>
        </A>
      </div>

      {sideLinks.slice(0, 2).map((l, i) => (
        <A key={i} href={l.href} className={'tpf-z tpf-side tpf-ink tpf-p ' + (i ? 'r' : 'l')} label={l.label} style={{ ...H(1 + i), left: i ? '71.5%' : '29.5%' }}>
          <span>{l.label}</span>
          <Icon name={l.icon} />
        </A>
      ))}

      <div className="tpf-z tpf-foot tpf-ink">
        <span className="tpf-p" style={H(3)}>{copyright}</span>
        {credit && <span className="tpf-credit tpf-p" style={H(4)}>{credit}</span>}
        {handle && <A href={handle.href} className="tpf-handle tpf-p" style={H(5)}>{handle.label}</A>}
      </div>
    </footer>
  )
}
