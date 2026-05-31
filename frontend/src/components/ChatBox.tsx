import type { FormEvent, KeyboardEvent } from 'react'

type ChatBoxProps = {
  value: string
  isLoading: boolean
  maxLength: number
  inputId?: string
  placeholder?: string
  onChange: (value: string) => void
  onSubmit: () => void
}

function ChatBox({
  value,
  isLoading,
  maxLength,
  inputId = 'chat-message',
  placeholder = 'Try: something like Bleu de Chanel but warmer',
  onChange,
  onSubmit,
}: ChatBoxProps) {
  const characterCount = value.length
  const isNearLimit = characterCount >= maxLength - 20
  const isAtLimit = characterCount >= maxLength

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    <form className="chat-form" onSubmit={handleSubmit}>
      <label className="sr-only" htmlFor={inputId}>
        Describe what you want in a fragrance
      </label>
      <div className="chat-input-shell">
        <textarea
          id={inputId}
          aria-label="Search for fragrance recommendations"
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value.slice(0, maxLength))}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !value.trim()}
          aria-label="Send fragrance search"
        >
          {isLoading ? (
            '...'
          ) : (
            <>
              <span className="send-button-text">Search</span>
              <span aria-hidden="true">→</span>
            </>
          )}
        </button>
      </div>
      {characterCount > 0 ? (
        <p
          className={`character-count ${isNearLimit ? 'near-limit' : ''} ${
            isAtLimit ? 'limit' : ''
          }`}
        >
          <span>{characterCount}/{maxLength}</span>
          {isAtLimit ? (
            <span className="character-hint">
              You reached the {maxLength} character limit.
            </span>
          ) : null}
        </p>
      ) : null}
    </form>
  )
}

export default ChatBox
