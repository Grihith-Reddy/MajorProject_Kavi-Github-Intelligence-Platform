import { useRef, type ReactNode } from 'react'
import { motion, useReducedMotion, useTransform } from 'framer-motion'

import farDay from '../../assets/parallax/far-day.webp'
import farNight from '../../assets/parallax/far-night.webp'
import midDay from '../../assets/parallax/mid-day.webp'
import midNight from '../../assets/parallax/mid-night.webp'
import frontDay from '../../assets/parallax/front-day.webp'
import frontNight from '../../assets/parallax/front-night.webp'
import { GlassGithubMark } from './GlassGithubMark'
import { SkyCanvas } from './SkyCanvas'
import { useScrollProgress } from './useScrollProgress'

/**
 * Landing hero as a layered landscape (adapted from 21st.dev / Osmo "Parallax"): an animated
 * cloud sky, a far mountain, rolling mid hills, the KAVI wordmark, and the front hilltop with a
 * glass GitHub mark. As the hero scrolls away each layer drifts down at its own pace, so nearer
 * layers seem to move faster.
 * Light and dark themes swap between day and night artwork with a cross-fade.
 */

function ThemedArt({ day, night, alt = '' }: { day: string; night: string; alt?: string }) {
  return (
    <>
      <img src={day} alt={alt} className="px-img px-img-day" loading="eager" decoding="async" draggable={false} />
      <img src={night} alt="" className="px-img px-img-night" loading="eager" decoding="async" draggable={false} />
    </>
  )
}

export function ParallaxHero({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  // 0 while the hero fills the screen, 1 once it has scrolled fully out of view.
  const scrollYProgress = useScrollProgress(ref, ['start start', 'end start'])
  const ySky = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
  const yFar = useTransform(scrollYProgress, [0, 1], ['0%', '58%'])
  const yMid = useTransform(scrollYProgress, [0, 1], ['0%', '42%'])
  const yTitle = useTransform(scrollYProgress, [0, 1], ['0%', '30%'])
  const yFront = useTransform(scrollYProgress, [0, 1], ['0%', '8%'])
  const yCopy = useTransform(scrollYProgress, [0, 1], ['0%', '-45%'])
  const copyOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0])

  const motionStyle = <T extends object>(style: T) => (reduce ? undefined : style)

  return (
    <div ref={ref} className="px">
      <motion.div className="px-layer px-sky" style={motionStyle({ y: ySky })}>
        <SkyCanvas className="px-sky-canvas" />
      </motion.div>

      <motion.div className="px-layer" style={motionStyle({ y: yFar })}>
        <div className="px-art px-art-far"><ThemedArt day={farDay} night={farNight} /></div>
      </motion.div>

      <motion.div className="px-layer" style={motionStyle({ y: yMid })}>
        <div className="px-art px-art-mid"><ThemedArt day={midDay} night={midNight} /></div>
      </motion.div>

      <motion.div className="px-layer" style={motionStyle({ y: yTitle })}>
        <div className="px-art px-art-front">
          <span className="px-wordmark" aria-hidden>KAVI</span>
        </div>
      </motion.div>

      <motion.div className="px-layer" style={motionStyle({ y: yFront })}>
        <div className="px-art px-art-front">
          <ThemedArt day={frontDay} night={frontNight} />
          <GlassGithubMark className="px-mark" />
        </div>
      </motion.div>

      <motion.div className="px-copy" style={motionStyle({ y: yCopy, opacity: copyOpacity })}>
        {children}
      </motion.div>
    </div>
  )
}
