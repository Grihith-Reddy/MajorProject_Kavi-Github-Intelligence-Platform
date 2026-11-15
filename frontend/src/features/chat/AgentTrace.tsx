import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileText,
  FolderSearch,
  GitPullRequest,
  LayoutGrid,
  ListChecks,
  ScanLine,
  Search,
  Users,
  type LucideIcon,
} from 'lucide-react'

import type { AgentTraceStep } from '../../services/chatStream'

const TOOL_ICONS: Record<string, LucideIcon> = {
  search_memory: Search,
  get_pull_request: GitPullRequest,
  read_file: FileText,
  find_files: FolderSearch,
  why_lines: ScanLine,
  who_knows: Users,
  repo_overview: LayoutGrid,
  list_promises: ListChecks,
}

/**
 * The agent's working steps, shown above its answer. Expanded while the agent is
 * working; folds into a one-line summary once the answer is complete.
 */
export function AgentTrace({ steps, notes = [], active }: { steps: AgentTraceStep[]; notes?: string[]; active: boolean }) {
  const [open, setOpen] = useState(active)

  useEffect(() => {
    setOpen(active)
  }, [active])

  if (!steps.length && !active) return null
  const running = steps.some((step) => step.status === 'running')

  return (
    <div className="kv-trace">
      <button
        type="button"
        className="kv-trace-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={`kv-trace-pulse${active ? ' is-active' : ''}`} aria-hidden />
        <span className="kv-trace-title">
          {active
            ? running
              ? steps[steps.length - 1]?.label ?? 'Working'
              : steps.length ? 'Writing the answer' : 'Thinking'
            : `Checked ${steps.length} source${steps.length === 1 ? '' : 's'}`}
        </span>
        {!active && (
          <span className="kv-trace-icons" aria-hidden>
            {steps.slice(0, 5).map((step) => {
              const Icon = TOOL_ICONS[step.tool] ?? Search
              return <Icon key={step.id} size={11} strokeWidth={2} />
            })}
          </span>
        )}
        {steps.length > 0 && (
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }} className="kv-trace-chevron">
            <ChevronDown size={13} />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && steps.length > 0 && (
          <motion.ol
            className="kv-trace-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30 }}
          >
            {steps.map((step, index) => {
              const Icon = TOOL_ICONS[step.tool] ?? Search
              return (
                <motion.li
                  key={step.id}
                  className={`kv-trace-step is-${step.status}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03, type: 'spring', stiffness: 300, damping: 26 }}
                >
                  <span className="kv-trace-icon">
                    {step.status === 'running' ? <Icon size={12} /> : step.status === 'error' ? <AlertCircle size={12} /> : <Check size={12} strokeWidth={2.5} />}
                  </span>
                  <span className="kv-trace-text">
                    <span className="kv-trace-label">{step.label}</span>
                    {step.summary && <span className="kv-trace-summary">{step.summary}</span>}
                  </span>
                </motion.li>
              )
            })}
            {notes.map((note, index) => (
              <li key={`note-${index}`} className="kv-trace-note">{note}</li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>
    </div>
  )
}
