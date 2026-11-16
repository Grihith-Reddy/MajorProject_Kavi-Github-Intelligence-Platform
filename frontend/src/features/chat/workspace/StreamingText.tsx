import { useEffect, useRef, useState } from 'react'

// ─── Typewriter hook ──────────────────────────────────────────────────────────
// Streams text character-by-character, mimicking ChatGPT / Claude / Gemini.
// Speed is adaptive: fast at start, settles to ~18ms/char for natural pacing.

function useTypewriter(text: string, active: boolean, onTick?: () => void, onComplete?: () => void) {
  const [displayed, setDisplayed] = useState(active ? '' : text)
  const indexRef = useRef(active ? 0 : text.length)
  const rafRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completionSentRef = useRef(false)

  useEffect(() => {
    completionSentRef.current = false
    if (!active) { setDisplayed(text); indexRef.current = text.length; return }
    indexRef.current = 0
    setDisplayed('')

    const markCompleted = () => {
      if (completionSentRef.current) return
      completionSentRef.current = true
      onComplete?.()
    }

    const tick = () => {
      if (indexRef.current >= text.length) { markCompleted(); return }
      // Chunk 1-3 chars per frame so very long messages don't drag
      const chunkSize = indexRef.current < 60 ? 1 : 2
      indexRef.current = Math.min(indexRef.current + chunkSize, text.length)
      setDisplayed(text.slice(0, indexRef.current))
      onTick?.()
      if (indexRef.current >= text.length) { markCompleted(); return }
      rafRef.current = setTimeout(tick, indexRef.current < 60 ? 14 : 10)
    }

    rafRef.current = setTimeout(tick, 60) // small initial delay feels natural
    return () => { if (rafRef.current) clearTimeout(rafRef.current) }
  }, [text, active, onTick, onComplete])

  return displayed
}

// ─── Streaming text bubble ────────────────────────────────────────────────────

export function StreamingText({ content, active, onTick, onComplete }: { content: string; active: boolean; onTick?: () => void; onComplete?: () => void }) {
  const displayed = useTypewriter(content, active, onTick, onComplete)
  return (
    <span style={{ whiteSpace: 'pre-wrap' }}>
      {displayed}
      {active && displayed.length < content.length && (
        <span style={{ display: 'inline-block', width: 2, height: '1em', background: 'var(--kv-solid)', marginLeft: 2, verticalAlign: 'text-bottom', animation: 'kavi-cursor-blink 0.8s step-end infinite' }} />
      )}
    </span>
  )
}
