import roster from '../data/roster.json'
import zones from '../data/zones.json'
import { SkillBadge } from '../components/SkillBadge'
import './AgentSelectScreen.css'

const zoneNameById = new Map(zones.map((z) => [z.id, z.name]))

export function AgentSelectScreen({ onSelect }) {
  return (
    <div className="agent-select">
      <header className="agent-select__header">
        <h1 className="agent-select__title">CONDUCTOR</h1>
        <p className="agent-select__subtitle">Qui es-tu ?</p>
      </header>

      <ul className="agent-select__list">
        {roster.map((agent) => (
          <li key={agent.id}>
            <button
              type="button"
              className="agent-select__item"
              onClick={() => onSelect(agent)}
            >
              <span className="agent-select__name">{agent.name}</span>
              <span className="agent-select__zone">
                {agent.is_reserve ? 'Réserviste' : zoneNameById.get(agent.current_zone)}
                {' · '}
                {agent.current_zone}
              </span>
              <span className="agent-select__skills">
                {agent.skills.map((s) => (
                  <SkillBadge key={s} skill={s} />
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
