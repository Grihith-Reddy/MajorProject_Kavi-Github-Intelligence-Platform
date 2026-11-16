import { useSyncExternalStore } from 'react'

/**
 * Lets the chat page put its actions (New chat, Export, Clear all chats) into the phone header's
 * More menu without threading props through the app shell.
 */
export interface ChatHeaderActions {
  onNewChat: () => void
  onExport: (format: 'markdown' | 'pdf') => void
  onClearAll: () => void
  hasConversation: boolean
}

let current: ChatHeaderActions | null = null
const listeners = new Set<() => void>()

export function setChatHeaderActions(actions: ChatHeaderActions | null) {
  current = actions
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useChatHeaderActions(): ChatHeaderActions | null {
  return useSyncExternalStore(subscribe, () => current, () => null)
}
