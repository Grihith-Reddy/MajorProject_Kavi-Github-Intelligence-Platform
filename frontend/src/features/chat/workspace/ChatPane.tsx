import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { ArrowDown, ArrowUp, FileDown, FileText, Menu, MessageSquarePlus, MoreHorizontal, Square, Trash2 } from 'lucide-react'
import { KaviMark } from '../../../components/KaviMark'
import { AgentTrace } from '../../../features/chat/AgentTrace'
import { AnswerFeedback } from '../../../features/chat/AnswerFeedback'
import { TimeTravelBanner, TimeTravelButton } from '../../../features/chat/TimeTravelControl'
import { formatAsOf } from '../../../utils/format'
import { MarkdownMessage } from '../../../features/chat/MarkdownMessage'
import { AnswerActions, EditQuestionButton } from '../../../features/chat/MessageActions'
import { StreamingText } from './StreamingText'
import { StructuredAssistantBody } from './StructuredAssistantBody'
import { QUICK_PROMPTS, followUpsFor, isWelcomeMessage, shouldRenderStructuredAnswer } from './chatHelpers'
import { type ChatPaneProps } from './chatTypes'

// ─── Chat pane ────────────────────────────────────────────────────────────────

/** Further than this from the newest message counts as "reading back". */
const LIVE_EDGE_PX = 120

export function ChatPane({ controls, repoId, repositoryName, userName, timeTravel, setTimeTravel, messages, chatLoading, chatInput, setChatInput, noPrContext, onSend, messagesEndRef, streamingIndex, onAssistantStreamComplete, onOpenMenu, menuOpen }: ChatPaneProps) {
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

  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    const onPointer = (event: PointerEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(false) }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [moreOpen])

  const questionCount = messages.filter((message) => message.role === 'user').length
  // Before the first question the pane is a centred start screen; the composer moves down after.
  const isEmpty = questionCount === 0
  const lastUserIndex = messages.map((message) => message.role).lastIndexOf('user')
  const lastAssistantIndex = messages.map((message) => message.role).lastIndexOf('assistant')
  const lastAssistant = messages[lastAssistantIndex]
  const followUps = !chatLoading && lastAssistant && !lastAssistant.live && lastAssistantIndex > lastUserIndex && questionCount > 0
    ? followUpsFor(lastAssistant.sources, lastAssistant.asOf)
    : []

  // The field grows with what is typed, up to a few lines, then scrolls.
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [multiline, setMultiline] = useState(false)
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    // Empty: one line, even if the placeholder is longer than the field.
    el.style.height = 'auto'
    const lineBox = el.clientHeight
    if (chatInput) el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    // A full pill for one line; softer corners once the text wraps, so no line is clipped.
    setMultiline(Boolean(chatInput) && el.scrollHeight > lineBox + 4)
  }, [chatInput, isEmpty])

  const repoShortName = repositoryName.split('/').pop() || repositoryName
  const firstName = userName?.split(/\s+/)[0] ?? null
  const canSend = Boolean(chatInput.trim())

  const composer = (
    <motion.div layoutId="kv-composer" className="kv-composer-wrap" transition={{ type: 'spring', stiffness: 260, damping: 32 }}>
      <AnimatePresence>
        {timeTravel && <TimeTravelBanner value={timeTravel} onClear={() => setTimeTravel(null)} />}
      </AnimatePresence>
      <div className={`kv-composer${multiline ? ' is-multiline' : ''}`}>
        <TimeTravelButton value={timeTravel} onChange={setTimeTravel} disabled={chatLoading} />
        <textarea
          ref={textareaRef}
          className="db-chat-textarea kv-composer-input"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(chatInput) } }}
          rows={1}
          disabled={chatLoading}
          aria-label="Ask KAVI about this repository"
          placeholder={isEmpty ? `Ask about ${repoShortName}…` : 'Ask a follow-up…'}
        />
        {chatLoading ? (
          <button className="kv-composer-btn is-stop" type="button" onClick={controls.onStop} aria-label="Stop answering" data-tip="Stop answering">
            <Square size={13} fill="currentColor" />
          </button>
        ) : (
          <button className="kv-composer-btn is-send" type="button" onClick={() => onSend(chatInput)} disabled={!canSend} aria-label="Send" data-tip={canSend ? 'Send' : undefined}>
            <ArrowUp size={18} strokeWidth={2.25} />
          </button>
        )}
      </div>
    </motion.div>
  )

  return (
    <section className={`db-chat-pane${isEmpty ? ' is-empty' : ''}`} style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--kv-mist)', borderRadius: 24, border: '1px solid var(--kv-line)', overflow: 'hidden' }}>
      <div className={`kv-chat-toolbar${isEmpty ? ' is-bare' : ''}`}>
        {/* Phones: the workspace rail collapses into this one button */}
        <button type="button" className="kv-chat-menu-btn" onClick={onOpenMenu} aria-haspopup="dialog" aria-expanded={menuOpen}>
          <Menu size={16} /> Workspace
        </button>
        {questionCount > 0 && (
          <span className="kv-chat-toolbar-meta">{questionCount} question{questionCount === 1 ? '' : 's'} in this conversation</span>
        )}
        <div className="kv-chat-toolbar-actions">
          {questionCount > 0 && (
            <button type="button" className="kv-msg-action" onClick={controls.onNewChat} aria-label="Start new chat" data-tip="Start new chat" data-tip-pos="below">
              <MessageSquarePlus size={15} />
            </button>
          )}
          <div className="kv-export" ref={moreRef}>
            <button type="button" className="kv-msg-action" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-haspopup="menu" aria-label="More options" data-tip={moreOpen ? undefined : 'More options'} data-tip-pos="below">
              <MoreHorizontal size={16} />
            </button>
            <AnimatePresence>
              {moreOpen && (
                <motion.div
                  className="kv-export-menu"
                  role="menu"
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
                  transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                >
                  <button type="button" role="menuitem" disabled={isEmpty} onClick={() => { controls.onExport('markdown'); setMoreOpen(false) }}><FileText size={14} /> Download as Markdown</button>
                  <button type="button" role="menuitem" disabled={isEmpty} onClick={() => { controls.onExport('pdf'); setMoreOpen(false) }}><FileDown size={14} /> Save as PDF</button>
                  <div className="kv-menu-divider" role="separator" />
                  <button type="button" role="menuitem" className="is-danger" onClick={() => { setMoreOpen(false); controls.onClearAll() }}><Trash2 size={14} /> Clear all chats</button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <LayoutGroup>
      {isEmpty ? (
        <div className="kv-chat-empty">
          <motion.div className="kv-empty-hero" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 26 }}>
            <KaviMark size={30} className="kv-empty-mark" />
            <h2 className="kv-empty-title">{firstName ? `Hi ${firstName}, what would you like to know?` : 'What would you like to know?'}</h2>
            <p className="kv-empty-sub">Ask why code in <strong>{repoShortName}</strong> exists, who decided something, or what changed.</p>
          </motion.div>
          {composer}
          <div className="kv-empty-prompts">
            {QUICK_PROMPTS.map((prompt, index) => (
              <motion.button
                key={prompt}
                type="button"
                className="kv-prompt-chip"
                onClick={() => onSend(prompt)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + index * 0.04, type: 'spring', stiffness: 320, damping: 26 }}
              >
                {prompt}
              </motion.button>
            ))}
          </div>
          {noPrContext && (
            <p className="kv-empty-note">No pull-request discussions are indexed yet. You can still ask; answers improve as more PRs are synced.</p>
          )}
        </div>
      ) : (
      <>
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

        {messages.map((message, index) => {
          // The welcome line belongs to the start screen now.
          if (isWelcomeMessage(message)) return null
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
          <div className="kv-trace-toggle is-active" role="status">
            <span className="kv-trace-pulse is-active" aria-hidden />
            <span className="kv-trace-title kv-shimmer">Thinking</span>
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


      <div className="db-chat-compose">
        {composer}
      </div>
      </>
      )}
      </LayoutGroup>

      <style>{`
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

          .db-repo-stats-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  )
}
