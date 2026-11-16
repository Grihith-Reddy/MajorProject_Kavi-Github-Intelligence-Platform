import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { setChatHeaderActions } from '../chatHeaderActions'
import { ChatPane } from './ChatPane'
import { WorkspaceIconRail, WorkspaceMenuSheet, WorkspaceOverlayPanel } from './WorkspacePanels'
import { WORKSPACE_PANEL_ITEMS } from './chatHelpers'
import { type WorkspacePanelId, type WorkspaceRenderProps } from './chatTypes'

// ─── Workspace layout ─────────────────────────────────────────────────────────

export function ChatWorkspace(props: WorkspaceRenderProps) {
  const [activePanel, setActivePanel] = useState<WorkspacePanelId | null>(null)
  const [railExpanded, setRailExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if (!activePanel && !menuOpen) return
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') { setActivePanel(null); setMenuOpen(false) } }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activePanel, menuOpen])

  // Phone header: New chat, Export and Clear all live in the header's More menu.
  const controlsRef = useRef(props.controls)
  controlsRef.current = props.controls
  const hasConversation = props.messages.some((message) => message.role === 'user')
  useEffect(() => {
    setChatHeaderActions({
      onNewChat: () => controlsRef.current.onNewChat(),
      onExport: (format) => controlsRef.current.onExport(format),
      onClearAll: () => controlsRef.current.onClearAll(),
      hasConversation,
    })
  }, [hasConversation])
  useEffect(() => () => setChatHeaderActions(null), [])

  const closePanel = () => setActivePanel(null)
  const handlePanelToggle = (panel: WorkspacePanelId) => setActivePanel((c) => (c === panel ? null : panel))
  const chooseFromMenu = (panel: WorkspacePanelId) => { setMenuOpen(false); setActivePanel(panel) }

  return (
    <div className="db-workspace-shell" style={{ position: 'fixed', inset: '90px 16px 16px', zIndex: 20 }}>
      <div className="db-workspace-inner" style={{ position: 'relative', height: '100%', maxWidth: 1440, margin: '0 auto' }}>
        {/* Main layout: icon rail + chat */}
        <div className="db-workspace-grid" style={{ display: 'grid', gridTemplateColumns: '54px minmax(0,1fr)', gap: 12, height: '100%', minHeight: 0 }}>
          <WorkspaceIconRail activePanel={activePanel} onToggle={handlePanelToggle} expanded={railExpanded} onExpandedChange={setRailExpanded} />
          <ChatPane
            controls={props.controls}
            repoId={props.repoId}
            repositoryName={props.repositoryName}
            userName={props.userName}
            timeTravel={props.timeTravel}
            setTimeTravel={props.setTimeTravel}
            messages={props.messages}
            chatLoading={props.chatLoading}
            chatInput={props.chatInput}
            setChatInput={props.setChatInput}
            noPrContext={props.noPrContext}
            onSend={props.onSend}
            messagesEndRef={props.messagesEndRef}
            streamingIndex={props.streamingIndex}
            onAssistantStreamComplete={props.onAssistantStreamComplete}
            onOpenMenu={() => setMenuOpen(true)}
            menuOpen={menuOpen}
          />
        </div>

        {/* Blur the chat while the rail shows its names */}
        <AnimatePresence>
          {railExpanded && (
            <motion.div
              key="rail-backdrop"
              className="db-rail-backdrop"
              aria-hidden
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15, ease: [0.7, 0, 0.84, 0] } }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            />
          )}
        </AnimatePresence>

        <WorkspaceMenuSheet open={menuOpen} activePanel={activePanel} onClose={() => setMenuOpen(false)} onChoose={chooseFromMenu} />

        {/* Slide-over panel */}
        <AnimatePresence>
          {activePanel && (
            <>
              <motion.button
                key="backdrop"
                type="button"
                aria-label="Close panel"
                onClick={closePanel}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{ position: 'absolute', inset: 0, zIndex: 28, background: 'rgb(var(--kv-veil-rgb) / 0.7)', backdropFilter: 'blur(4px)', border: 'none', cursor: 'pointer' }}
              />
              <motion.aside
                key={`panel-${activePanel}`}
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 34, mass: 0.78 }}
                className="db-overlay-panel"
                style={{
                  position: 'absolute', insetBlock: 0, left: 62,
                  width: 'min(400px, calc(100% - 70px))',
                  zIndex: 36,
                  background: 'var(--kv-surface)',
                  borderRadius: 24,
                  border: '1px solid var(--kv-line)',
                  boxShadow: '0 24px 48px rgb(var(--kv-ink-rgb) / 0.12)',
                  padding: 16,
                  overflowY: 'auto',
                  scrollbarWidth: 'none',
                }}
              >
                {/* Panel header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <p style={{ fontFamily: "'Archivo', sans-serif", fontSize: 15, fontWeight: 600, color: 'var(--kv-ink)' }}>
                    {WORKSPACE_PANEL_ITEMS.find((i) => i.id === activePanel)?.label ?? 'Workspace'}
                  </p>
                  <button
                    type="button"
                    onClick={closePanel}
                    aria-label="Close panel"
                    style={{ width: 30, height: 30, borderRadius: 9999, border: '1px solid var(--kv-line)', background: 'var(--kv-mist)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--kv-ink)' }}
                  >
                    <X size={14} />
                  </button>
                </div>

                <WorkspaceOverlayPanel
                  panel={activePanel}
                  repoId={props.repoId}
                  repositoryName={props.repositoryName}
                  entries={props.entries}
                  files={props.files}
                  chatSources={props.chatSources}
                  entriesLoading={props.entriesLoading}
                  entriesError={props.entriesError}
                  filesLoading={props.filesLoading}
                  filesError={props.filesError}
                  gitVisualization={props.gitVisualization}
                  gitVisualizationLoading={props.gitVisualizationLoading}
                  gitVisualizationError={props.gitVisualizationError}
                  onNavigate={closePanel}
                  historyNode={props.renderHistory(closePanel)}
                />
              </motion.aside>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
