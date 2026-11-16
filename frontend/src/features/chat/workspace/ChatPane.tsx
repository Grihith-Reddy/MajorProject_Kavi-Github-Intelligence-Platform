import { useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Send } from 'lucide-react'
import { AgentTrace } from '../../../features/chat/AgentTrace'
import { AnswerFeedback } from '../../../features/chat/AnswerFeedback'
import { TimeTravelBanner, TimeTravelButton } from '../../../features/chat/TimeTravelControl'
import { formatAsOf } from '../../../utils/format'
import { MarkdownMessage } from '../../../features/chat/MarkdownMessage'
import { StreamingText } from './StreamingText'
import { StructuredAssistantBody } from './StructuredAssistantBody'
import { QUICK_PROMPTS, shouldRenderStructuredAnswer } from './chatHelpers'
import { type ChatPaneProps } from './chatTypes'

// ─── Chat pane ────────────────────────────────────────────────────────────────

export function ChatPane({ repoId, timeTravel, setTimeTravel, messages, chatLoading, chatInput, setChatInput, noPrContext, onSend, messagesEndRef, streamingIndex, onAssistantStreamComplete }: ChatPaneProps) {
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const assistantMessageRefs = useRef<Record<number, HTMLElement | null>>({})

  const scrollToAssistantStart = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const node = assistantMessageRefs.current[index]
    if (!node) return
    node.scrollIntoView({ behavior, block: 'start', inline: 'nearest' })
  }, [])

  const followAssistantStream = useCallback((index: number) => {
    const container = messagesContainerRef.current
    const node = assistantMessageRefs.current[index]
    if (!container || !node) return

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
    scrollToAssistantStart(streamingIndex, 'smooth')
  }, [scrollToAssistantStart, streamingIndex])

  const liveIndex = messages.length - 1
  const liveMessage = messages[liveIndex]
  const hasLiveAnswer = Boolean(liveMessage?.live)
  const liveContentLength = liveMessage?.content.length ?? 0
  const liveTraceLength = liveMessage?.trace?.length ?? 0
  useEffect(() => {
    if (!hasLiveAnswer) return
    followAssistantStream(liveIndex)
  }, [followAssistantStream, liveIndex, liveContentLength, liveTraceLength, hasLiveAnswer])

  return (
    <section className="db-chat-pane" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: 'var(--kv-mist)', borderRadius: 24, border: '1px solid var(--kv-line)', overflow: 'hidden' }}>
      {/* Messages */}
      <div className="db-chat-messages" ref={messagesContainerRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 12, scrollbarWidth: 'none' }}>

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
                        <MarkdownMessage content={message.content} streaming={Boolean(message.live)} repoId={repoId} prUrls={message.prUrls} />
                      )}
                      {!message.live && message.messageId && <AnswerFeedback messageId={message.messageId} />}
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

        <div ref={messagesEndRef} />
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
            placeholder="Ask about architecture, PR evolution, or type 'Explain Entire Repo'…"
            style={{ flex: 1, resize: 'none', border: 'none', outline: 'none', boxShadow: 'none', fontFamily: "'Archivo', sans-serif", fontSize: 14, color: 'var(--kv-ink)', background: 'transparent', minHeight: 24, maxHeight: 120, lineHeight: 1.5, padding: 0 }}
          />
          <button
            className="db-send-btn"
            type="button"
            onClick={() => onSend(chatInput)}
            disabled={chatLoading || !chatInput.trim()}
            style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 12, background: 'var(--kv-solid)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', opacity: (!chatInput.trim() || chatLoading) ? 0.4 : 1, transition: 'opacity 0.15s' }}
          >
            <Send size={15} color="var(--kv-on-solid)" />
          </button>
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
            inset: 78px 10px 10px !important;
          }

          .db-workspace-grid {
            grid-template-columns: 1fr !important;
            grid-template-rows: auto minmax(0, 1fr);
            gap: 10px !important;
          }

          .db-icon-rail {
            flex-direction: row !important;
            justify-content: space-between !important;
            align-items: center !important;
            width: 100%;
            border-radius: 16px !important;
            padding: 8px !important;
          }

          .db-icon-rail button {
            width: 36px !important;
            height: 36px !important;
            border-radius: 12px !important;
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
            border-radius: 16px !important;
            padding: 8px 8px 8px 12px !important;
            gap: 8px !important;
          }

          .db-chat-textarea {
            font-size: 13px !important;
          }

          .db-send-btn {
            width: 34px !important;
            height: 34px !important;
            border-radius: 10px !important;
          }

          .db-overlay-panel {
            left: 0 !important;
            right: 0 !important;
            width: 100% !important;
            border-radius: 18px !important;
            inset-block: 46px 0 !important;
          }
        }

        @media (max-width: 480px) {
          .db-workspace-shell {
            inset: 74px 6px 8px !important;
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
