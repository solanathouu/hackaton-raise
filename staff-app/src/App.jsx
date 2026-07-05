import { useState } from 'react'
import { AgentSelectScreen } from './screens/AgentSelectScreen'
import { MainScreen } from './screens/MainScreen'
import { getSocket } from './socket'

function App() {
  const [agent, setAgent] = useState(null)
  const socket = getSocket()

  if (!agent) {
    return <AgentSelectScreen onSelect={setAgent} />
  }

  return <MainScreen agent={agent} socket={socket} onChangeAgent={() => setAgent(null)} />
}

export default App
