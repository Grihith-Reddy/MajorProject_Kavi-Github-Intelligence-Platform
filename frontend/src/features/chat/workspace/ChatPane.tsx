import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, Download, FileDown, FileText, Loader2, Menu, MessageSquarePlus, Send, Square } from 'lucide-react'
import { AgentTrace } from '../../../features/chat/AgentTrace'
import { AnswerFeedback } from '../../../features/chat/AnswerFeedback'
import { TimeTravelBanner, TimeTravelButton } from '../../../features/chat/TimeTravelControl'
import { formatAsOf } from '../../../utils/format'
import { MarkdownMessage } from '../../../features/chat/MarkdownMessage'
import { AnswerActions, EditQuestionButton } from '../../../features/chat/MessageActions'
import { StreamingText } from './StreamingText'
import { StructuredAssistantBody } from './StructuredAssistantBody'
import { QUICK_PROMPTS, followUpsFor, shouldRenderStructuredAnswer } from './chatHelpers'
import { type ChatPaneProps } from './chatTypes'

// ─── Chat pane ────────────────────────────────────────────────────────────────

/** Further than this from the newest message counts as "reading back". */
const LIVE_EDGE_PX = 120

export function ChatPane({ controls, repoId, timeTravel, setTimeTravel, messages, chatLoading, chatInput, setChatInput, noPrContext, onSend, messagesEndRef, streamingIndex, onAssistantStreamComplete, onOpenMenu, menuOpen }: ChatPaneProps) {
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const assistantMessageRefs = useRef<Record<number, HTMLElement | null>>({})

  const scrollToAssistantStart = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const node = assistantMessageRefs.current[index]
    if (!node) return
    node.scrollIntoView({ behavior, block: 'start', inline: 'nearest' })
  }, [])

  const [awayFromLatest, setAwayFromLatest] = useState(false)
  const [readingBack, setReadingBackState] = useState(false)
  const readingBackRef = useRef(false)   // the reader scrolled up on purpose: stop following
  const gestureDirRef = useRef<'up' | 'down' | null>(null)
  const touchYRef = useRef<number | null>(null)
  const setReadingBack = useCallback((value: boolean) => {
    readingBackRef.current = value
    setReadingBackState(value)
  }, [])

  const measureEdge = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return false
    const away = el.scrollHeight - el.scrollTop - el.clientHeight > LIVE_EDGE_PX
    setAwayFromLatest(away)
    return away
  }, [])

  // Any upward wheel, swipe or key means "let me read": stop following at once. Reaching the
  // newest message again by scrolling down resumes it. Our own programmatic scrolls never count.
  const readUp = useCallback(() => { gestureDirRef.current = 'up'; setReadingBack(true) }, [setReadingBack])
  const readDown = useCallback(() => { gestureDirRef.current = 'down' }, [])

  const onMessagesScroll = useCallback(() => {
    const away = measureEdge()
    if (!away && gestureDirRef.current === 'down') setReadingBack(false)
  }, [measureEdge, setReadingBack])

  const onWheel = useCallback((event: React.WheelEvent) => { if (event.deltaY < 0) readUp(); else if (event.deltaY > 0) readDown() }, [readUp, readDown])
  const onTouchStart = useCallback((event: React.TouchEvent) => { touchYRef.current = event.touches[0]?.clientY ?? null }, [])
  const onTouchMove = useCallback((event: React.TouchEvent) => {
    const y = event.touches[0]?.clientY
    if (y === undefined || touchYRef.current === null) return
    if (y > touchYRef.current + 4) readUp()       // finger moves down: content scrolls up
    else if (y < touchYRef.current - 4) readDown()
    touchYRef.current = y
  }, [readUp, readDown])
  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) readUp()
    else if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) readDown()
  }, [readUp, readDown])


  const followAssistantStream = useCallback((index: number) => {
    const container = messagesContainerRef.current
    const node = assistantMessageRefs.current[index]
    if (!container || !node || readingBackRef.current) return

    const containerRect = container.getBoundingClientRect()
    const nodeRect = node.getBoundingClientRect()
    const topPadding = 12
    const bottomPadding = 40

    if (nodeRect.top < containerRect.top + topPadding) {
      container.scrollTop += nodeRect.top - (containerRect.top + topPadding)
      return
    }

    if (nodeRect.bottom > containerRect.bottom - bottomPadding) {
      container.scrollTop += nodeRect.bottom - (containerRect.bottom - bottomPadding)
    }
  }, [])

  useEffect(() => {
    if (streamingIndex === null) return
    setReadingBack(false)   // a new question always brings its answer into view
    scrollToAssistantStart(streamingIndex, 'smooth')
  }, [scrollToAssistantStart, setReadingBack, streamingIndex])

  const liveIndex = messages.length - 1
  const liveMessage = messages[liveIndex]
  const hasLiveAnswer = Boolean(liveMessage?.live)
  const liveContentLength = liveMessage?.content.length ?? 0
  const liveTraceLength = liveMessage?.trace?.length ?? 0
  useEffect(() => {
    if (!hasLiveAnswer) return
    followAssistantStream(liveIndex)
  }, [followAssistantStream, liveIndex, liveContentLength, liveTraceLength, hasLiveAnswer])

  // Growing content does not fire scroll events, so re-measure after every render that changes it.
  useLayoutEffect(() => { measureEdge() }, [measureEdge, messages.length, liveContentLength, liveTraceLength])

  // While an answer streams and we are following it, there is nothing to jump to.
  const showJump = awayFromLatest && (!hasLiveAnswer || readingBack)
  const jumpToLatest = useCallback(() => {
    const el = messagesContainerRef.current
    if (!el) return
    setReadingBack(false)
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    // Mid-answer, land on the answer's start (where following keeps it); otherwise the very end.
    if (hasLiveAnswer) scrollToAssistantStart(liveIndex, behavior)
    else el.scrollTo({ top: el.scrollHeight, behavior })
  }, [hasLiveAnswer, liveIndex, scrollToAssistantStart, setReadingBack])

  const [exportOpen, setExportOpen] = useState(false)
  const questionCount = messages.filter((message) => message.role === 'user').length
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user')
  const lastAssistantIndex = messages.map((message) => message.role).lastIndexOf('assistant')
  const lastAssistant = messages[lastAssistantIndex]
  const followUps = !chatLoading && lastAssistant && !lastAssistant.live && lastAssistantIndex > lastUserIndex && questionCount > 0
    ? followUpsFor(lastAssistant.sources, lastAssistant.asOf)
    : []

  return (
    <section className="db-chat-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--kv-mist)', borderRadius: 24, border: '1px solid var(--kv-line)', overflow: 'hidden' }}>
      <div className={`kv-chat-toolbar${questionCount === 0 ? ' is-bare' : ''}`}>
        {/* Phones: the workspace rail collapses into this one button */}
        <button type="button" className="kv-chat-menu-btn" onClick={onOpenMenu} aria-haspopup="dialog" aria-expanded={menuOpen}>
          <Menu size={16} /> Workspace
        </button>
        {questionCount > 0 && (
          <span className="kv-chat-toolbar-meta">{questionCount} question{questionCount === 1 ? '' : 's'} in this conversation</span>
        )}
        {questionCount > 0 && (
          <div className="kv-chat-toolbar-actions">
            <button type="button" className="kv-msg-action" onClick={controls.onNewChat} aria-label="Start new chat" data-tip="Start new chat" data-tip-pos="below">
              <MessageSquarePlus size={14} />
            </button>
            <div className="kv-export">
              <button type="button" className="kv-msg-action" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen} aria-label="Export chat" data-tip="Export chat" data-tip-pos="below">
                <Download size={14} />
              </button>
              <AnimatePresence>
                {exportOpen && (
                  <motion.div
                    className="kv-export-menu"
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    onMouseLeave={() => setExportOpen(false)}
                  >
                    <button type="button" onClick={() => { controls.onExport('markdown'); setExportOpen(false) }}><FileText size={14} /> Markdown file</button>
                    <button type="button" onClick={() => { controls.onExport('pdf'); setExportOpen(false) }}><FileDown size={14} /> PDF (print)</button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="db-chat-scroller">
      <div
        className="db-chat-messages"
        ref={messagesContainerRef}
        onScroll={onMessagesScroll}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onKeyDown={onKeyDown}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 12, scrollbarWidth: 'none' }}
      >

        {noPrContext && (
          <div style={{ borderRadius: 16, border: '1px solid var(--kv-line)', background: 'var(--kv-surface)', padding: '14px 18px' }}>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 14, fontWeight: 600, color: 'var(--kv-ink)', marginBottom: 4 }}>No pull-request discussions found yet.</p>
            <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 13, color: 'var(--kv-ink-2)', lineHeight: 1.5 }}>You can still query the repository. Answers will improve as richer PR context is indexed.</p>
          </div>
        )}

        {messages.map((message, index) => {
          const isStreaming = message.role === 'assistant' && index === streamingIndex
          const hasStructuredAnswer = message.role === 'assistant' && shouldRenderStructuredAnswer(message.structured)
          const useStreamingRenderer = message.role === 'assistant' && isStreaming && !hasStructuredAnswer
          return (
            <motion.article
              key={`${message.role}-${index}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 26 }}
              ref={(node) => {
                if (message.role !== 'assistant') return
                assistantMessageRefs.current[index] = node
              }}
              className={`db-message-row ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
              style={{ display: 'flex', justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start' }}
            >
              <div className={`db-message-bubble ${message.role === 'user' ? 'is-user' : 'is-assistant'}`} style={{
                maxWidth: message.role === 'user' ? 'min(75%, 560px)' : 'min(88%, 760px)',
                borderRadius: message.role === 'user' ? '20px 20px 6px 20px' : '20px 20px 20px 6px',
                padding: '12px 16px',
                fontFamily: "'Archivo', sans-serif",
                fontSize: 14,
                lineHeight: 1.6,
                ...(message.role === 'user'
                  ? { background: 'var(--kv-solid)', color: 'var(--kv-on-solid)', boxShadow: '0 4px 16px rgb(var(--kv-ink-rgb) / 0.18)' }
                  : { background: 'var(--kv-surface)', color: 'var(--kv-ink)', border: '1px solid var(--kv-line)', boxShadow: '0 2px 8px rgb(var(--kv-ink-rgb) / 0.06)' }
                ),
              }}>
                {message.role === 'assistant' && (message.format === 'markdown' || message.structured?.format === 'markdown')
                  ? (
                    <>
                      {(message.asOf ?? message.structured?.as_of) && (
                        <span className="kv-asof-chip">As of {formatAsOf((message.asOf ?? message.structured?.as_of) as string)}</span>
                      )}
                      <AgentTrace steps={message.trace ?? message.structured?.trace ?? []} notes={message.notes} active={Boolean(message.live)} />
                      {(message.content || !message.live) && (
                        <MarkdownMessage content={message.content} streaming={Boolean(message.live)} repoId={repoId} prUrls={message.prUrls} sources={message.sources} />
                      )}
                      {!message.live && message.content && (
                        <div className="kv-msg-footer">
                          <AnswerActions content={message.content} canRegenerate={index === lastAssistantIndex && !chatLoading && lastUserIndex >= 0} onRegenerate={controls.onRegenerate} />
                          {message.messageId && <AnswerFeedback messageId={message.messageId} />}
                        </div>
                      )}
                    </>
                  )
                  : useStreamingRenderer
                  ? (
                    <StreamingText
                      content={message.content}
                      active
                      onTick={() => followAssistantStream(index)}
                      onComplete={() => onAssistantStreamComplete(index)}
                    />
                  )
                  : message.role === 'assistant' && hasStructuredAnswer && message.structured
                  ? <StructuredAssistantBody content={message.content} structured={message.structured} />
                  : message.role === 'assistant' && message.structured?.summary
                    ? <span style={{ whiteSpace: 'pre-wrap' }}>{message.structured.summary}</span>
                  : message.role === 'assistant'
                    ? <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
                    : message.content}
                {message.role === 'user' && index === lastUserIndex && !chatLoading && <EditQuestionButton onEdit={controls.onEditLast} />}
              </div>
            </motion.article>
          )
        })}

        {chatLoading && !hasLiveAnswer && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--kv-surface)', border: '1px solid var(--kv-line)', borderRadius: 9999, padding: '8px 14px', fontFamily: "'Gabarito', sans-serif", fontSize: 13, color: 'rgb(var(--kv-ink-rgb) / 0.55)', width: 'fit-content' }}>
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
            Thinking…
          </div>
        )}

        <AnimatePresence>
          {followUps.length > 0 && (
            <motion.div
              key={`followups-${lastAssistantIndex}`}
              className="kv-followups"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 280, damping: 28 }}
            >
              <span className="kv-eyebrow">Ask next</span>
              {followUps.map((question) => (
                <button key={question} type="button" className="kv-followup" onClick={() => onSend(question)}>{question}</button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>
      <button
        type="button"
        className={`kv-jump-latest${showJump ? ' is-active' : ''}${showJump && hasLiveAnswer ? ' is-live' : ''}`}
        onClick={(event) => {
          jumpToLatest()
          // The button hides itself: hand focus on rather than leave it on a hidden control.
          if (event.detail === 0) document.querySelector<HTMLTextAreaElement>('.db-chat-textarea')?.focus()
          else event.currentTarget.blur()
        }}
        aria-label={hasLiveAnswer ? 'Jump to the answer being written' : 'Jump to latest message'}
        aria-hidden={!showJump}
        tabIndex={showJump ? 0 : -1}
        data-tip="Jump to latest"
      >
        <ArrowDown size={16} />
      </button>
      </div>

      {/* Quick prompts + input */}
      <div className="db-chat-compose" style={{ padding: '8px 16px 14px', flexShrink: 0 }}>
        {/* Starter prompts: only until the first question is asked */}
        <AnimatePresence initial={false}>
          {!messages.some((message) => message.role === 'user') && (
            <motion.div
              key="starter-prompts"
              className="db-quick-prompt-row"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'none' }}
            >
              {QUICK_PROMPTS.map((prompt, index) => (
                <motion.button
                  key={prompt}
                  type="button"
                  className="kv-prompt-chip"
                  onClick={() => onSend(prompt)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.04, type: 'spring', stiffness: 320, damping: 26 }}
                >
                  {prompt}
                </motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input bar */}
        <AnimatePresence>
          {timeTravel && <TimeTravelBanner value={timeTravel} onClear={() => setTimeTravel(null)} />}
        </AnimatePresence>
        <div
          className="db-chat-input-row"
          style={{ display: 'flex', alignItems: 'flex-end', gap: 10, background: 'var(--kv-surface)', border: '1.5px solid var(--kv-line)', borderRadius: 20, padding: '10px 10px 10px 16px', boxShadow: '0 2px 8px rgb(var(--kv-ink-rgb) / 0.06)', transition: 'border-color 0.15s' }}
          onFocusCapture={(e) => (e.currentTarget.style.borderColor = 'var(--kv-ink)')}
          onBlurCapture={(e) => (e.currentTarget.style.borderColor = 'var(--kv-line)')}
        >
          <TimeTravelButton value={timeTravel} onChange={setTimeTravel} disabled={chatLoading} />
          <textarea
            className="db-chat-textarea"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(chatInput) } }}
            rows={1}
            disabled={chatLoading}
            aria-label="Ask KAVI about this repository"
            placeholder="Ask about this repository…"
            style={{ flex: '1 1 0', minWidth: 0, width: '100%', resize: 'none', border: 'none', outline: 'none', boxShadow: 'none', fontFamily: "'Archivo', sans-serif", fontSize: 14, color: 'var(--kv-ink)', background: 'transparent', minHeight: 24, maxHeight: 120, lineHeight: 1.5, padding: 0, scrollbarWidth: 'none' }}
          />
          {chatLoading ? (
            <button className="db-send-btn kv-stop-btn" type="button" onClick={controls.onStop} aria-label="Stop answering" data-tip="Stop answering">
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              className="db-send-btn"
              type="button"
              onClick={() => onSend(chatInput)}
              disabled={!chatInput.trim()}
              aria-label="Send"
              style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 12, background: 'var(--kv-solid)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: !chatInput.trim() ? 0.4 : 1, transition: 'opacity 0.15s, transform 0.2s var(--kv-spring)' }}
            >
              <Send size={15} color="var(--kv-on-solid)" />
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes kavi-cursor-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        textarea:focus { outline: none !important; box-shadow: none !important; }

        @media (max-width: 1024px) {
          .db-code-ref-grid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 820px) {
          .db-workspace-shell {
            top: 78px !important;
            left: 10px !important;
            right: 10px !important;
          }

          .db-workspace-grid {
            grid-template-columns: 1fr !important;
            gap: 0 !important;
          }

          .db-chat-pane {
            border-radius: 18px !important;
          }

          .db-chat-messages {
            padding: 14px 12px 8px !important;
          }

          .db-message-bubble {
            max-width: min(94%, 760px) !important;
            padding: 10px 12px !important;
            font-size: 13px !important;
          }

          .db-chat-compose {
            padding: 6px 10px 10px !important;
          }

          .db-chat-input-row {
            border-radius: 9999px !important;
            padding: 5px !important;
            gap: 6px !important;
            align-items: center !important;
          }

          .db-chat-input-row .kv-tt-btn,
          .db-chat-input-row .db-send-btn {
            width: 44px !important;
            height: 44px !important;
            border-radius: 9999px !important;
          }

          /* 16px keeps iOS Safari from zooming the page when the field is focused. */
          .db-chat-textarea {
            font-size: 16px !important;
            line-height: 24px !important;
            min-height: 44px !important;
            max-height: 44px !important;
            padding: 10px 6px !important;
          }


          .db-overlay-panel {
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            border-radius: 18px !important;
            inset-block: 0 !important;
          }
        }

        @media (max-width: 480px) {
          .db-workspace-shell {
            top: 74px !important;
            left: 6px !important;
            right: 6px !important;
          }

          .db-quick-prompt-row button {
            font-size: 12px !important;
            padding: 6px 11px !important;
          }

          .db-repo-stats-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  )
}
