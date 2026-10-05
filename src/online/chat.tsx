import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { MessageCircle, Send, X } from 'lucide-react'
import { CHAT_MAX_LENGTH, type ChatMessage, type ChatPostResponse, type ChatResponse } from '../shared/api'
import { errorMessage } from './api'
import { useSession } from './session'
import { Avatar } from './ui'
import './chat.css'

export type ChatController = {
  messages: ChatMessage[]
  loading: boolean
  error: string | null
  /** Text messages from others since the panel was last open. */
  unread: number
  /** The newest unread text message, for a short preview. */
  latest: ChatMessage | null
  receive: (message: ChatMessage) => void
  send: (body: string) => Promise<boolean>
  setOpen: (open: boolean) => void
  reload: () => void
}

const QUICK_MESSAGES = ['Game on! 🎯', 'Good darts!', 'Unlucky', 'Nice finish!', 'GG 🤝']

function merge(messages: ChatMessage[], incoming: ChatMessage[]) {
  const known = new Set(messages.map((message) => message.id))
  const added = incoming.filter((message) => !known.has(message.id))
  if (!added.length) return messages
  return [...messages, ...added].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200)
}

/**
 * Chat for one thread (a lobby, or a match). Messages arrive through the page's own live
 * stream (`receive`); the initial history and anything missed while offline come from `load`.
 */
export function useChat(key: string | null, load: () => Promise<ChatResponse>, post: (body: string) => Promise<ChatPostResponse>, initiallyOpen = false): ChatController {
  const { user } = useSession()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [latest, setLatest] = useState<ChatMessage | null>(null)
  const open = useRef(initiallyOpen)
  const known = useRef(new Set<string>())
  const loadRef = useRef(load)
  const postRef = useRef(post)
  useLayoutEffect(() => {
    loadRef.current = load
    postRef.current = post
  })

  const reload = useCallback(() => {
    if (key === null) return
    setLoading(true)
    loadRef.current()
      .then(({ messages: history }) => {
        for (const message of history) known.current.add(message.id)
        setMessages((current) => merge(current, history))
        setError(null)
      })
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setLoading(false))
  }, [key])

  useEffect(() => {
    known.current = new Set()
    setMessages([])
    setUnread(0)
    setLatest(null)
    reload()
  }, [reload])

  const receive = useCallback((message: ChatMessage) => {
    if (known.current.has(message.id)) return
    known.current.add(message.id)
    setMessages((current) => merge(current, [message]))
    if (!open.current && message.kind === 'text' && message.user.id !== user?.id) {
      setUnread((count) => count + 1)
      setLatest(message)
    }
  }, [user?.id])

  const send = useCallback(async (body: string) => {
    try {
      const { message } = await postRef.current(body)
      known.current.add(message.id)
      setMessages((current) => merge(current, [message]))
      setError(null)
      return true
    } catch (caught) {
      setError(errorMessage(caught))
      return false
    }
  }, [])

  const setOpen = useCallback((value: boolean) => {
    open.current = value
    if (value) {
      setUnread(0)
      setLatest(null)
    }
  }, [])

  return { messages, loading, error, unread, latest, receive, send, setOpen, reload }
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

export function ChatPanel({ chat, title = 'Chat', onClose, canPost = true, disabledReason, className = '' }: {
  chat: ChatController
  title?: string
  onClose?: () => void
  canPost?: boolean
  disabledReason?: string
  className?: string
}) {
  const { user } = useSession()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)
  const { setOpen } = chat

  useEffect(() => {
    setOpen(true)
    return () => setOpen(false)
  }, [setOpen])

  useLayoutEffect(() => {
    const list = listRef.current
    if (list && pinned.current) list.scrollTop = list.scrollHeight
  }, [chat.messages.length])

  const submit = async (body: string) => {
    const text = body.trim()
    if (!text || sending || !canPost) return
    setSending(true)
    const sent = await chat.send(text.slice(0, CHAT_MAX_LENGTH))
    setSending(false)
    if (sent && body === draft) setDraft('')
    pinned.current = true
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submit(draft)
  }

  return (
    <section className={`chat-panel ${className}`} aria-label={title}>
      <header className="chat-head">
        <MessageCircle size={15} />
        <h2>{title}</h2>
        {onClose && <button type="button" className="chat-close" onClick={onClose} aria-label="Close chat"><X size={16} /></button>}
      </header>
      <ol
        ref={listRef}
        className="chat-messages"
        aria-live="polite"
        onScroll={(event) => {
          const list = event.currentTarget
          pinned.current = list.scrollHeight - list.scrollTop - list.clientHeight < 40
        }}
      >
        {chat.messages.length === 0 && <li className="chat-empty">{chat.loading ? 'Loading chat…' : 'No messages yet. Say hello!'}</li>}
        {chat.messages.map((message, index) => {
          if (message.kind === 'system') return <li key={message.id} className="chat-system">{message.body}</li>
          const previous = chat.messages[index - 1]
          const grouped = previous?.kind === 'text' && previous.user.id === message.user.id && Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 120_000
          const mine = message.user.id === user?.id
          return (
            <li key={message.id} className={`chat-message ${mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}>
              {!grouped && <span className="chat-author"><Avatar user={message.user} size={18} /><b>{mine ? 'You' : message.user.name}</b><time dateTime={message.createdAt}>{timeFormat.format(new Date(message.createdAt))}</time></span>}
              <p>{message.body}</p>
            </li>
          )
        })}
      </ol>
      {chat.error && <p className="chat-error" role="alert">{chat.error}</p>}
      {canPost ? (
        <>
          <div className="chat-quick" aria-label="Quick messages">
            {QUICK_MESSAGES.map((message) => <button key={message} type="button" disabled={sending} onClick={() => void submit(message)}>{message}</button>)}
          </div>
          <form className="chat-form" onSubmit={onSubmit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, CHAT_MAX_LENGTH))}
              placeholder="Write a message…"
              aria-label="Chat message"
              maxLength={CHAT_MAX_LENGTH}
              autoComplete="off"
              enterKeyHint="send"
            />
            {draft.length > CHAT_MAX_LENGTH - 40 && <small className="chat-count">{CHAT_MAX_LENGTH - draft.length}</small>}
            <button className="chat-send" disabled={sending || !draft.trim()} aria-label="Send message"><Send size={16} /></button>
          </form>
        </>
      ) : <p className="chat-readonly">{disabledReason ?? 'Only players can chat here.'}</p>}
    </section>
  )
}

/** Header button with an unread badge and a short preview of the newest message. */
export function ChatToggle({ chat, onOpen }: { chat: ChatController; onOpen: () => void }) {
  const [peek, setPeek] = useState<string | null>(null)
  useEffect(() => {
    if (!chat.latest) return
    setPeek(chat.latest.id)
    const timer = window.setTimeout(() => setPeek(null), 5000)
    return () => window.clearTimeout(timer)
  }, [chat.latest])
  return (
    <span className="chat-toggle-wrap">
      <button className="icon-button chat-toggle" onClick={onOpen} aria-label={chat.unread ? `Open chat (${chat.unread} unread)` : 'Open chat'}>
        <MessageCircle size={18} />
        {chat.unread > 0 && <span className="chat-badge">{chat.unread > 9 ? '9+' : chat.unread}</span>}
      </button>
      {chat.latest && peek === chat.latest.id && (
        <button className="chat-peek" onClick={onOpen}><b>{chat.latest.user.name}</b> {chat.latest.body}</button>
      )}
    </span>
  )
}
