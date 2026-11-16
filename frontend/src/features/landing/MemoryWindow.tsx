import { useRef } from 'react'
import { motion, useReducedMotion, useTransform } from 'framer-motion'
import { Check, FileCode2, GitPullRequest, Search, ScanLine } from 'lucide-react'

import cloudImg from '../../assets/cloud.webp'
import { useScrollProgress } from './useScrollProgress'

/**
 * Scroll-driven reveal adapted from 21st.dev "Smooth Scroll Hero" (ishamsu):
 * a window cut into the sky widens as you scroll, revealing KAVI at work.
 * The original animates clip-path, which repaints the whole window every frame. Here a rounded frame
 * in the page colour sits over the window and only scales, which the compositor does without
 * repainting, so the reveal holds 60 fps. The content is KAVI's own.
 */
export function MemoryWindow() {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const scrollYProgress = useScrollProgress(ref, ['start start', 'end end'])

  // The opening starts at 56% of the window (22% in from each side) and widens to the full window.
  const holeScale = useTransform(scrollYProgress, [0, 0.75], [0.56, 1])
  const cloudScale = useTransform(scrollYProgress, [0, 1], [1.7, 1])
  const productScale = useTransform(scrollYProgress, [0.1, 0.8], [0.82, 1])
  const productY = useTransform(scrollYProgress, [0.1, 0.8], [60, 0])
  const captionOpacity = useTransform(scrollYProgress, [0, 0.25], [1, 0])
  const calloutOpacity = useTransform(scrollYProgress, [0.55, 0.8], [0, 1])

  if (reduce) {
    return (
      <section className="mw-static" aria-label="KAVI at work">
        <div className="mw-sky"><img src={cloudImg} alt="" className="mw-cloud" loading="lazy" decoding="async" /></div>
        <div className="mw-product-wrap"><ProductPreview /></div>
      </section>
    )
  }

  return (
    <section ref={ref} className="mw" aria-label="KAVI at work">
      <div className="mw-sticky">
        <motion.p className="mw-caption" style={{ opacity: captionOpacity }}>Scroll to look inside</motion.p>
        <div className="mw-window">
          <div className="mw-sky">
            {/* Below the fold: load when scrolled near, so it does not compete with the hero art. */}
            <motion.img src={cloudImg} alt="" className="mw-cloud" loading="lazy" decoding="async" style={{ scale: cloudScale }} />
          </div>
          <motion.div className="mw-product-wrap" style={{ scale: productScale, y: productY }}>
            <ProductPreview />
          </motion.div>
          <motion.p className="mw-callout" style={{ opacity: calloutOpacity }}>
            Every answer cites the pull request it came from.
          </motion.p>
        </div>
        {/* Everything outside the rounded opening is covered in the page colour. */}
        <div className="mw-mask" aria-hidden>
          <motion.div className="mw-hole" style={{ scale: holeScale }} />
        </div>
      </div>
    </section>
  )
}

function ProductPreview() {
  return (
    <div className="mw-product" aria-hidden>
      <div className="mw-chat">
        <div className="mw-user">Why do we keep a ledger of webhook ids?</div>
        <div className="mw-answer">
          <span className="mw-trace"><span className="mw-dot" /> Checked 3 sources <Search size={11} /> <ScanLine size={11} /></span>
          <p>
            Payment providers deliver webhooks <strong>at least once</strong>, so the handler records each event id before
            applying it, which makes retries harmless <span className="mw-chip"><GitPullRequest size={10} /> PR #42</span>.
          </p>
          <p>The check lives in <span className="mw-chip"><FileCode2 size={10} /> handler.py <em>18–22</em></span>.</p>
          <span className="mw-kept"><Check size={11} /> Follow-up promise kept in PR #51</span>
        </div>
      </div>
      <div className="mw-lens">
        <div className="mw-lens-head"><FileCode2 size={11} /> handler.py</div>
        {[
          ['#73CEF2', 'def handle(event):'],
          ['#73CEF2', '    if ledger.seen(event.id):'],
          ['#73CEF2', '        return ok()'],
          ['#C3B1F5', '    ledger.record(event.id)'],
          ['#C3B1F5', '    retry = backoff(attempt)'],
          ['#FFB59A', '    return apply(event)'],
        ].map(([color, code], index) => (
          <div key={index} className="mw-line"><span className="mw-band" style={{ background: color }} /><span className="mw-ln">{18 + index}</span>{code}</div>
        ))}
        <div className="mw-lens-foot"><span style={{ background: '#73CEF2' }} />#42 idempotency <span style={{ background: '#C3B1F5' }} />#57 backoff</div>
      </div>
    </div>
  )
}
