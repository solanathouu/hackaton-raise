import { useCallback, useRef, useState } from 'react'
import './PushToTalkButton.css'

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Bouton maintenu (F1 du PRD) : appui = enregistre, relâche = envoie.
// MediaRecorder natif, pas de librairie tierce.
export function PushToTalkButton({ onRecordingStart, onRecordingComplete, disabled }) {
  const [state, setState] = useState('idle') // idle | recording | error
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)

  const start = useCallback(async () => {
    if (disabled || state === 'recording') return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setState('recording')
      onRecordingStart?.()
    } catch (err) {
      console.error('Micro inaccessible :', err)
      setState('error')
      setTimeout(() => setState('idle'), 2000)
    }
  }, [disabled, state, onRecordingStart])

  const stop = useCallback(() => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      setState('idle')
      if (blob.size > 0) {
        const base64 = await blobToBase64(blob)
        onRecordingComplete?.(base64)
      }
    }
    recorder.stop()
  }, [onRecordingComplete])

  const label =
    state === 'recording' ? 'Enregistrement…' : state === 'error' ? 'Micro indisponible' : 'Maintiens pour parler'

  return (
    <div className="ptt">
      <button
        type="button"
        className={`ptt__button${state === 'recording' ? ' ptt__button--recording' : ''}`}
        disabled={disabled}
        onPointerDown={(e) => {
          e.preventDefault()
          start()
        }}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        aria-label="Push-to-talk : signaler un incident"
      >
        <MicIcon />
      </button>
      <span className="ptt__label">{label}</span>
    </div>
  )
}

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" fill="white" />
      <path d="M5 11a7 7 0 0014 0" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 18v3" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
