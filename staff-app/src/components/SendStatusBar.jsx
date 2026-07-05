import './SendStatusBar.css'

// Écran 3 (optionnel du PRD) : comble le ~3s de latence STT + LLM + moteur
// avec un retour visuel plutôt qu'un écran figé.
const LABELS = {
  recording: 'Enregistrement…',
  sending: 'Envoi…',
  transcribing: 'Transcription en cours…',
}

export function SendStatusBar({ status }) {
  if (!status) return null
  return (
    <div className="send-status" role="status">
      <span className="send-status__dot" />
      {LABELS[status] ?? status}
    </div>
  )
}
