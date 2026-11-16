import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from 'framer-motion'
import { FileCode2, GitCommitHorizontal, GitPullRequest, MessageSquareText, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react'

/**
 * Scroll-assembled statement (adapted from 21st.dev "Text scroll animation", Skiper 31).
 * One pinned stage: while it holds the screen, the letters of "REMEMBER WHY" fly in from a
 * spread, tipped-back line, then KAVI's building blocks swing in between code brackets, and
 * both hold for a beat before the page moves on. Spread distances scale with the screen.
 * Uses the landing page's existing smooth scroll (no extra Lenis instance).
 */

const TITLE = 'REMEMBER WHY'
const PIECES: Array<{ icon: LucideIcon; label: string }> = [
  { icon: GitPullRequest, label: 'Pull requests' },
  { icon: GitCommitHorizontal, label: 'Commits' },
  { icon: MessageSquareText, label: 'Review threads' },
  { icon: FileCode2, label: 'Files' },
  { icon: ShieldCheck, label: 'Guardian' },
  { icon: Sparkles, label: 'AI answers' },
]

/** Pixels each step away from the centre starts out, scaled to the viewport width. */
function useSpread() {
  const [spread, setSpread] = useState(50)
  useEffect(() => {
    const update = () => setSpread(Math.max(26, Math.min(50, window.innerWidth * 0.06)))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return spread
}

// Where each part assembles along the stage's scroll (0 = stage enters, 1 = stage leaves).
const TITLE_RANGE = [0.08, 0.5]
const PIECES_RANGE = [0.42, 0.82]

function Letter({ char, offset, spread, progress }: { char: string; offset: number; spread: number; progress: MotionValue<number> }) {
  const x = useTransform(progress, TITLE_RANGE, [offset * spread, 0])
  const rotateX = useTransform(progress, TITLE_RANGE, [offset * 50, 0])
  return (
    <motion.span className={`sa-char${char === ' ' ? ' is-space' : ''}`} style={{ x, rotateX }} aria-hidden>
      {char}
    </motion.span>
  )
}

function Piece({ icon: Icon, label, offset, spread, progress }: { icon: LucideIcon; label: string; offset: number; spread: number; progress: MotionValue<number> }) {
  const x = useTransform(progress, PIECES_RANGE, [offset * spread * 1.8, 0])
  const rotate = useTransform(progress, PIECES_RANGE, [offset * 50, 0])
  const y = useTransform(progress, PIECES_RANGE, [-Math.abs(offset) * 20, 0])
  const scale = useTransform(progress, PIECES_RANGE, [0.75, 1])
  const opacity = useTransform(progress, [PIECES_RANGE[0] - 0.1, PIECES_RANGE[0] + 0.08], [0, 1])
  return (
    <motion.span className="sa-piece" style={{ x, rotate, y, scale, opacity }} title={label}>
      <Icon strokeWidth={1.7} aria-hidden />
      <span className="sr-only">{label}</span>
    </motion.span>
  )
}

function Bracket({ flip }: { flip?: boolean }) {
  return (
    <svg className={`sa-bracket${flip ? ' is-flip' : ''}`} viewBox="0 0 27 78" fill="currentColor" aria-hidden>
      <path d="M26.52 77.21h-5.75c-6.83 0-12.38-5.56-12.38-12.38V48.38C8.39 43.76 4.63 40 .01 40v-4c4.62 0 8.38-3.76 8.38-8.38V12.4C8.38 5.56 13.94 0 20.77 0h5.75v4h-5.75c-4.62 0-8.38 3.76-8.38 8.38V27.6c0 4.34-2.25 8.17-5.64 10.38 3.39 2.21 5.64 6.04 5.64 10.38v16.45c0 4.62 3.76 8.38 8.38 8.38h5.75v4.02Z" />
    </svg>
  )
}

export function ScrollAssemble() {
  const ref = useRef<HTMLElement>(null)
  const reduce = useReducedMotion()
  const spread = useSpread()
  // 0 when the section's top enters the bottom of the screen, 1 when its stage unpins.
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] })
  // Under reduced motion everything sits assembled.
  const still = useTransform(scrollYProgress, () => 1)
  const captionOpacity = useTransform(scrollYProgress, [PIECES_RANGE[0] - 0.1, PIECES_RANGE[0] + 0.08], [0, 1])
  const progress = reduce ? still : scrollYProgress
  const chars = TITLE.split('')
  const charCentre = Math.floor(chars.length / 2)
  const pieceCentre = Math.floor(PIECES.length / 2)

  return (
    <section ref={ref} className="sa" aria-label="KAVI remembers why">
      <div className="sa-stage">
        <h2 className="sa-title" aria-label="Remember why">
          {chars.map((char, i) => (
            <Letter key={i} char={char} offset={i - charCentre} spread={spread} progress={progress} />
          ))}
        </h2>
        <motion.p className="sa-caption" style={reduce ? undefined : { opacity: captionOpacity }}>
          <Bracket />
          <span>every change, remembered</span>
          <Bracket flip />
        </motion.p>
        <div className="sa-pieces">
          {PIECES.map((piece, i) => (
            <Piece key={piece.label} {...piece} offset={i - pieceCentre} spread={spread} progress={progress} />
          ))}
        </div>
      </div>
    </section>
  )
}
