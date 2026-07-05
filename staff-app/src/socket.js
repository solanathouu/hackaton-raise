import { io } from 'socket.io-client'
import { MockSocket } from './mock/mockSocket'

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'
const COORDINATOR_URL = import.meta.env.VITE_COORDINATOR_URL || 'https://localhost:3000'

let socket = null

// Point d'entrée unique : le reste de l'app ne sait jamais si elle parle au
// vrai coordinateur (P2) ou au mock local. Bascule via VITE_USE_MOCKS=false
// une fois le vrai coordinateur prêt (H+1:30 selon le kickoff).
export function getSocket() {
  if (socket) return socket
  socket = USE_MOCKS ? new MockSocket() : io(COORDINATOR_URL, { autoConnect: false })
  return socket
}

export const usingMocks = USE_MOCKS
