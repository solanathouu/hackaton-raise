import { useEffect, useState } from 'react'
import zones from '../data/zones.json'
import './AlertPanel.css'

const zoneNameById = new Map(zones.map((z) => [z.id, z.name]))
const SPEECH_LANG = { fr: 'fr-FR', en: 'en-US', es: 'es-ES' }
const ACK_WINDOW_S = 15 // F6 : fenêtre d'accusé avant re-route auto côté serveur

function speak(text, lang) {
  if (!('speechSynthesis' in window)) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = SPEECH_LANG[lang] ?? 'fr-FR'
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}

// Joue l'alerte vocale : audioUrl réel du coordinateur si dispo (TTS Gradium),
// sinon repli sur la synthèse vocale du navigateur (utile en mock, où
// audioUrl pointe vers un fichier fictif).
function playAlertAudio(audioUrl, text, lang) {
  if (!audioUrl) return speak(text, lang)
  const audio = new Audio(audioUrl)
  audio.addEventListener('error', () => speak(text, lang))
  audio.play().catch(() => speak(text, lang))
}

export function AlertPanel({ alert, onAck, onDismiss }) {
  const [secondsLeft, setSecondsLeft] = useState(ACK_WINDOW_S)
  const [acked, setAcked] = useState(false)

  useEffect(() => {
    if (!alert) return
    setAcked(false)
    setSecondsLeft(ACK_WINDOW_S)

    if (alert.kind === 'dispatch') {
      playAlertAudio(alert.payload.audioUrl, alert.payload.text, alert.payload.lang)
    }
  }, [alert])

  useEffect(() => {
    if (!alert || alert.kind !== 'dispatch' || acked) return
    if (secondsLeft <= 0) return
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [alert, acked, secondsLeft])

  if (!alert) return null

  const zoneId = alert.kind === 'dispatch' ? alert.payload.targetZone : alert.payload.zoneId
  const zoneName = zoneNameById.get(zoneId) ?? zoneId

  if (alert.kind === 'coverage_warning') {
    return (
      <div className="alert-panel alert-panel--warning">
        <div className="alert-panel__head">
          <span className="alert-panel__zone">
            {zoneId} · {zoneName.toUpperCase()}
          </span>
          <span className="alert-panel__timestamp">
            trou estimé dans ~{Math.round(alert.payload.etaSec / 60)} min
          </span>
        </div>
        <p className="alert-panel__text">{alert.payload.message}</p>
        <button type="button" className="alert-panel__action alert-panel__action--ghost" onClick={onDismiss}>
          Vu
        </button>
      </div>
    )
  }

  const isBackfill = alert.payload.role === 'backfill'

  return (
    <div className="alert-panel">
      <div className="alert-panel__head">
        <span className="alert-panel__zone">
          {zoneId} · {zoneName.toUpperCase()}
        </span>
        <span className="alert-panel__timestamp">{isBackfill ? 'backfill' : 'dispatch'}</span>
      </div>
      <p className="alert-panel__text">{alert.payload.text}</p>
      {!acked && secondsLeft > 0 && (
        <p className="alert-panel__countdown">accusé attendu sous {secondsLeft}s</p>
      )}
      <button
        type="button"
        className="alert-panel__action"
        disabled={acked}
        onClick={() => {
          setAcked(true)
          onAck(alert.payload.assignmentId)
        }}
      >
        {acked ? 'Pris en charge' : "Je m'en occupe"}
      </button>
    </div>
  )
}
