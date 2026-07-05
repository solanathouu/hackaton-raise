import { useEffect, useRef, useState } from 'react'
import { ParkMap } from '../components/ParkMap'
import { PushToTalkButton } from '../components/PushToTalkButton'
import { AlertPanel } from '../components/AlertPanel'
import { SendStatusBar } from '../components/SendStatusBar'
import { RouteBanner } from '../components/RouteBanner'
import { computeShortestRoute } from '../lib/routing'
import './MainScreen.css'

const SEND_STATUS_FAILSAFE_MS = 6000 // F9 résilience : jamais d'écran figé si rien ne revient
const ACK_DISMISS_DELAY_MS = 1200

export function MainScreen({ agent, socket, onChangeAgent }) {
  const [zoneStates, setZoneStates] = useState(null)
  const [queue, setQueue] = useState([])
  const [sendStatus, setSendStatus] = useState(null)
  const [agentZone, setAgentZone] = useState(agent.current_zone)
  const [route, setRoute] = useState(null)
  const failsafeRef = useRef(null)

  useEffect(() => {
    const handleState = (snapshot) => setZoneStates(snapshot.zones)
    const handleDispatch = (payload) => {
      setQueue((q) => [...q, { kind: 'dispatch', payload }])
      setSendStatus(null)
    }
    const handleCoverageWarning = (payload) => {
      setQueue((q) => [...q, { kind: 'coverage_warning', payload }])
      setSendStatus(null)
    }

    socket.on('state', handleState)
    socket.on('dispatch', handleDispatch)
    socket.on('coverage_warning', handleCoverageWarning)

    socket.connect()
    socket.emit('hello', { agentId: agent.id })
    socket.emit('position', { agentId: agent.id, zoneId: agent.current_zone })

    return () => {
      socket.off('state', handleState)
      socket.off('dispatch', handleDispatch)
      socket.off('coverage_warning', handleCoverageWarning)
    }
  }, [socket, agent])

  useEffect(() => {
    clearTimeout(failsafeRef.current)
    if (sendStatus === 'sending' || sendStatus === 'transcribing') {
      failsafeRef.current = setTimeout(() => setSendStatus(null), SEND_STATUS_FAILSAFE_MS)
    }
    return () => clearTimeout(failsafeRef.current)
  }, [sendStatus])

  const activeAlert = queue[0] ?? null

  const activeZoneIds = new Set(
    queue.filter((a) => a.kind === 'dispatch').map((a) => a.payload.targetZone)
  )

  const handleRecordingStart = () => setSendStatus('recording')

  const handleRecordingComplete = (base64Audio) => {
    setSendStatus('sending')
    socket.emit('incident_audio', { agentId: agent.id, audio: base64Audio, ts: Date.now() })
    setTimeout(() => setSendStatus('transcribing'), 350)
  }

  const handleAck = (assignmentId) => {
    socket.emit('ack', { assignmentId })
    if (activeAlert?.kind === 'dispatch') {
      const targetZone = activeAlert.payload.targetZone
      const result = computeShortestRoute(agentZone, targetZone)
      if (result) setRoute({ targetZone, ...result })
    }
    setTimeout(() => setQueue((q) => q.slice(1)), ACK_DISMISS_DELAY_MS)
  }

  const handleDismissWarning = () => setQueue((q) => q.slice(1))

  const handleArrived = () => {
    if (route) {
      setAgentZone(route.targetZone)
      socket.emit('position', { agentId: agent.id, zoneId: route.targetZone })
    }
    setRoute(null)
  }

  return (
    <div className="main-screen">
      <header className="main-screen__header">
        <span className="main-screen__agent">{agent.name}</span>
        <button type="button" className="main-screen__change" onClick={onChangeAgent}>
          changer
        </button>
      </header>

      <div className="main-screen__map">
        <ParkMap zoneStates={zoneStates} activeZoneIds={activeZoneIds} route={route?.path} agentZoneId={agentZone} />
      </div>

      {route && (
        <div className="main-screen__route">
          <RouteBanner route={route} onArrived={handleArrived} />
        </div>
      )}

      <div className="main-screen__bottom">
        <SendStatusBar status={sendStatus} />

        {activeAlert && (
          <AlertPanel alert={activeAlert} onAck={handleAck} onDismiss={handleDismissWarning} />
        )}

        <div className="main-screen__ptt">
          <PushToTalkButton
            onRecordingStart={handleRecordingStart}
            onRecordingComplete={handleRecordingComplete}
          />
        </div>
      </div>
    </div>
  )
}
