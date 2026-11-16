import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useTransform } from 'framer-motion'
import { AlertTriangle, Check, GitPullRequest, History, MessageSquareText, ScanLine, ShieldCheck } from 'lucide-react'
import { useScrollProgress } from './useScrollProgress'

interface Entry {
  kicker: string
  title: string
  body: string
  visual: ReactNode
}

const ENTRIES: Entry[] = [
  {
    kicker: '01',
    title: 'Remembers',
    body: 'Ask in plain language. KAVI researches your pull requests, the live code and its blame, then answers with every claim cited.',
    visual: (
      <div className="tl-vis tl-vis-chat">
        <span className="tl-step"><Check size={11} /> Searched memory · 3 PRs</span>
        <span className="tl-step"><Check size={11} /> Read handler.py</span>
        <p>Retries are safe because events are recorded first <span className="tl-chip"><GitPullRequest size={10} /> PR #42</span>.</p>
      </div>
    ),
  },
  {
    kicker: '02',
    title: 'Explains',
    body: 'Why-Lens maps every line of a file to the pull request that wrote it, and the reason that pull request gave.',
    visual: (
      <div className="tl-vis tl-vis-lens">
        {['#73CEF2', '#73CEF2', '#C3B1F5', '#C3B1F5', '#C3B1F5', '#FFB59A'].map((color, index) => (
          <span key={index} className="tl-code-line"><i style={{ background: color }} />{['def handle(event):', '  if seen(event):', '    return ok()', '  record(event)', '  apply(event)', '  notify()'][index]}</span>
        ))}
      </div>
    ),
  },
  {
    kicker: '03',
    title: 'Warns',
    body: 'Guardian reviews every new pull request against decisions your team already made, and flags files that usually change together.',
    visual: (
      <div className="tl-vis tl-vis-guard">
        <span className="tl-verdict"><AlertTriangle size={12} /> Possible conflict</span>
        <p>Removes the ledger check that <strong>PR #42</strong> added to prevent double charges.</p>
        <span className="tl-muted"><ShieldCheck size={11} /> Posted on PR #77 by the Guardian Action</span>
      </div>
    ),
  },
  {
    kicker: '04',
    title: 'Keeps promises',
    body: '“I will fix this in a follow-up.” KAVI notices the promise, then notices the pull request that kept it, or that never came.',
    visual: (
      <div className="tl-vis tl-vis-promise">
        <span className="tl-kind">Follow-up</span>
        <p>Add a retention policy for the webhook ledger</p>
        <span className="tl-kept"><Check size={11} /> Kept in PR #51, 19 days later</span>
      </div>
    ),
  },
  {
    kicker: '05',
    title: 'Maps context',
    body: 'See who really understands each part of the codebase, which modules depend on one quiet expert, and what always changes together.',
    visual: (
      <div className="tl-vis tl-vis-map">
        <svg viewBox="0 0 220 110" aria-hidden>
          <line x1="60" y1="55" x2="140" y2="35" /><line x1="60" y1="55" x2="150" y2="85" /><line x1="140" y1="35" x2="195" y2="70" />
          <circle cx="60" cy="55" r="26" className="ok" /><circle cx="140" cy="35" r="17" className="warn" /><circle cx="150" cy="85" r="14" className="risk" /><circle cx="195" cy="70" r="11" className="ok" />
        </svg>
        <span className="tl-muted">2 modules rely on a single expert</span>
      </div>
    ),
  },
  {
    kicker: '06',
    title: 'Travels in time',
    body: 'Pick any past date and ask what the code looked like then, and why it changed after. Answers only use what existed at that moment.',
    visual: (
      <div className="tl-vis tl-vis-time">
        <span className="tl-asof"><History size={11} /> As of 14 Apr 2025</span>
        <div className="tl-range"><span style={{ width: '38%' }} /></div>
        <p><MessageSquareText size={12} /> Only PR #1 existed then: the enrollment module.</p>
        <span className="tl-muted"><ScanLine size={11} /> Files read at commit 7716fd3</span>
      </div>
    ),
  },
]

/**
 * "What's new" timeline adapted from 21st.dev "Timeline" (Aceternity): sticky titles
 * with a beam that fills as you scroll, recoloured in KAVI's sky gradient.
 */
export function MemoryTimeline() {
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const measure = () => setHeight(element.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const scrollYProgress = useScrollProgress(containerRef, ['start 10%', 'end 50%'])
  // Grow the beam with scaleY (compositor only) rather than height, which would re-lay out every frame.
  const beamScale = useTransform(scrollYProgress, [0, 1], [0, 1])
  const beamOpacity = useTransform(scrollYProgress, [0, 0.1], [0, 1])

  return (
    <div className="tl" ref={containerRef}>
      <div className="tl-head">
        <p className="k-eyebrow">What’s new in KAVI 2.0</p>
        <h2 className="k-sec-h2 font-archivo">From a memory you search<br />to a teammate that speaks up.</h2>
      </div>
      <div ref={listRef} className="tl-list">
        {ENTRIES.map((entry) => (
          <div key={entry.title} className="tl-row">
            <div className="tl-sticky">
              <div className="tl-node"><span /></div>
              <div className="tl-title">
                <span className="tl-kicker">{entry.kicker}</span>
                <h3>{entry.title}</h3>
              </div>
            </div>
            <motion.div
              className="tl-content"
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ type: 'spring', stiffness: 120, damping: 22 }}
            >
              <h3 className="tl-title-mobile">{entry.title}</h3>
              <p className="tl-body">{entry.body}</p>
              {entry.visual}
            </motion.div>
          </div>
        ))}
        <div className="tl-rail" style={{ height }}>
          <motion.div className="tl-beam" style={{ scaleY: beamScale, opacity: beamOpacity }} />
        </div>
      </div>
    </div>
  )
}
