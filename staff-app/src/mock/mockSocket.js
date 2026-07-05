import zones from '../data/zones.json'
import roster from '../data/roster.json'

// Simule le coordinateur (P2) + la boucle STT/LLM (P3/P5) le temps que le vrai
// backend soit branché. Même surface d'API qu'un socket.io-client réel
// (on/off/emit) pour que le reste de l'app n'ait jamais à savoir lequel des
// deux elle utilise (contrat A du PRD).

function computeZoneStatus(zoneId, agents) {
  const zone = zones.find((z) => z.id === zoneId)
  const headcount = agents.filter(
    (a) => a.current_zone === zoneId && a.status === 'available'
  ).length
  const surplus = headcount - zone.required_min
  return { ...zone, headcount, surplus }
}

function buildStateSnapshot(agents) {
  return {
    agents,
    zones: zones.map((z) => computeZoneStatus(z.id, agents)),
  }
}

// Scénarios canned (section 11 du PRD) : jouent tour à tour à chaque PTT pour
// pouvoir démontrer/tester les 4 capacités sans backend réel.
const SCENARIOS = [
  {
    name: 'S1 — surplus, zéro cascade',
    transcript: 'malaise près du grand huit',
    events: [
      {
        delay: 1400,
        type: 'dispatch',
        payload: {
          assignmentId: 'as_s1_1',
          incidentId: 'inc_s1',
          role: 'primary',
          targetZone: 'Z2',
          text: 'Malaise signalé au Grand Huit, tu es le plus proche et qualifié. Vas-y.',
          lang: 'fr',
        },
      },
    ],
  },
  {
    name: 'S2 — cascade 2 hops',
    transcript: 'arrêt cardiaque au manège extrême, il ne respire plus',
    events: [
      {
        delay: 1400,
        type: 'dispatch',
        payload: {
          assignmentId: 'as_s2_1',
          incidentId: 'inc_s2',
          role: 'primary',
          targetZone: 'Z8',
          text: 'Arrêt cardiaque au Manège Extrême, tu es le plus proche. Vas-y.',
          lang: 'fr',
        },
      },
      {
        delay: 2600,
        type: 'dispatch',
        payload: {
          assignmentId: 'as_s2_2',
          incidentId: 'inc_s2',
          role: 'backfill',
          targetZone: 'Z8',
          text: 'Rejoins le Manège Extrême pour maintenir la couverture.',
          lang: 'fr',
        },
      },
    ],
  },
  {
    name: 'S3 — alerte proactive de trou',
    transcript: '2e incident simultané, plus de surplus disponible',
    events: [
      {
        delay: 1400,
        type: 'coverage_warning',
        payload: {
          zoneId: 'Z6',
          etaSec: 180,
          message: 'Zone Enfants tombera sous le minimum ~3 min. Accepter / réassigner ?',
        },
      },
    ],
  },
  {
    name: 'S4 — réserviste + multilingue',
    transcript: 'un hombre se desplomó en la entrada, no respira',
    events: [
      {
        delay: 1400,
        type: 'dispatch',
        payload: {
          assignmentId: 'as_s4_1',
          incidentId: 'inc_s4',
          role: 'primary',
          targetZone: 'Z1',
          text: 'Colapso en la Entrada, eres el más cercano disponible. Ve ahora.',
          lang: 'es',
        },
      },
    ],
  },
]

export class MockSocket {
  constructor() {
    this.listeners = new Map()
    this.connected = false
    this.agents = roster.map((a) => ({ ...a }))
    this.agentId = null
    this._scenarioIndex = 0
    this._timers = []
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event).add(cb)
    return this
  }

  off(event, cb) {
    this.listeners.get(event)?.delete(cb)
    return this
  }

  _fire(event, payload) {
    this.listeners.get(event)?.forEach((cb) => cb(payload))
  }

  connect() {
    this.connected = true
    return this
  }

  disconnect() {
    this.connected = false
    this._timers.forEach(clearTimeout)
    this._timers = []
    return this
  }

  // Emule le serveur : reçoit les events "client -> serveur" du contrat A.
  emit(event, payload) {
    switch (event) {
      case 'hello':
        this.agentId = payload.agentId
        setTimeout(() => this._fire('state', buildStateSnapshot(this.agents)), 150)
        break

      case 'position': {
        const agent = this.agents.find((a) => a.id === payload.agentId)
        if (agent) agent.current_zone = payload.zoneId
        this._fire('state', buildStateSnapshot(this.agents))
        break
      }

      case 'incident_audio': {
        const scenario = SCENARIOS[this._scenarioIndex % SCENARIOS.length]
        this._scenarioIndex += 1
        // eslint-disable-next-line no-console
        console.info(`[mock] scénario "${scenario.name}" — transcript simulé : "${scenario.transcript}"`)
        scenario.events.forEach(({ delay, type, payload: p }) => {
          const t = setTimeout(() => this._fire(type, p), delay)
          this._timers.push(t)
        })
        break
      }

      case 'ack': {
        // Pas d'état serveur à faire évoluer côté mock : l'app locale gère
        // déjà l'UI d'accusé optimiste.
        break
      }

      case 'operator_override':
        break

      default:
        break
    }
  }
}
