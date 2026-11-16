import { useEffect, type RefObject } from 'react'
import { useMotionValue, type MotionValue } from 'framer-motion'

/** "<target edge> <viewport edge>", e.g. "start end": the target's top meets the viewport's bottom. */
type Offset = `${string} ${string}`

function edge(value: string): number {
  if (value === 'start') return 0
  if (value === 'center') return 0.5
  if (value === 'end') return 1
  if (value.endsWith('%')) return parseFloat(value) / 100
  return parseFloat(value) || 0
}

/** Top of the element in page coordinates, from layout offsets (unaffected by CSS transforms). */
function pageTop(el: HTMLElement): number {
  let top = 0
  let node: HTMLElement | null = el
  while (node) {
    top += node.offsetTop
    node = node.offsetParent as HTMLElement | null
  }
  return top
}

/**
 * Scroll progress (0 to 1) of a section between two offsets, like framer-motion's
 * useScroll({ target, offset }) but without its per-frame layout reads: the section's position is
 * measured once and again only when the page resizes, and each scroll frame is plain arithmetic on
 * window.scrollY. That keeps scroll-linked animation from forcing a layout every frame.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, offset: [Offset, Offset]): MotionValue<number> {
  const progress = useMotionValue(0)
  const [from, to] = offset

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const [fromTarget, fromView] = from.split(' ').map(edge)
    const [toTarget, toView] = to.split(' ').map(edge)
    let start = 0
    let end = 1

    const update = () => {
      const span = end - start
      const value = span > 0 ? (window.scrollY - start) / span : 0
      progress.set(Math.min(1, Math.max(0, value)))
    }
    const measure = () => {
      const top = pageTop(el)
      const height = el.offsetHeight
      const view = window.innerHeight
      start = top + fromTarget * height - fromView * view
      end = top + toTarget * height - toView * view
      update()
    }

    measure()
    window.addEventListener('scroll', update, { passive: true })
    // Anything above the section changing size moves it, and that changes the page's height.
    const resize = new ResizeObserver(measure)
    resize.observe(document.body)
    resize.observe(el)
    window.addEventListener('resize', measure)
    window.addEventListener('load', measure)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', measure)
      window.removeEventListener('load', measure)
      resize.disconnect()
    }
  }, [ref, from, to, progress])

  return progress
}
