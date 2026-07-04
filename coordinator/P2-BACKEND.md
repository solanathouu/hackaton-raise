# CONDUCTOR Coordinator

P2 backend/coordinator for the CONDUCTOR demo. It keeps the local-first live state, exposes the frozen WebSocket contract, runs deterministic coverage math, persists the incident log to SQLite, and can run end-to-end without Crusoe/Gradium keys through mock/deterministic mode.

## Run

```bash
cd coordinator
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000` for the diagnostic console. Phone microphone capture needs HTTPS, so generate mkcert certs and set `HTTPS_KEY_PATH` / `HTTPS_CERT_PATH` in `.env` when the staff PWA is ready.

## Contract A WebSocket Events

Client to server:

- `hello { agentId }`
- `position { agentId, zoneId }`
- `incident_audio { agentId, audio, ts }`
- `ack { assignmentId }`
- `operator_override { incidentId, newAgentId, reason }`

Server to client:

- `state { agents, zones, incidents, assignments, constraints }`
- `dispatch { assignmentId, incidentId, role, targetZone, text, audioUrl, lang }`
- `coverage_warning { zoneId, etaSec, message, incidentId }`

The server also emits operator-friendly `incident_update`, `assignment_update`, `learned_constraints`, and `pipeline_error` events.

## Demo Helpers

```bash
curl -X POST http://localhost:3000/api/demo/reset
curl -X POST http://localhost:3000/api/demo/sim_incident -H "Content-Type: application/json" -d "{\"scenario\":\"S2\"}"
curl -X POST http://localhost:3000/api/assignments/as_1/ack
```

Scenarios:

- `S1`: Grand Huit surplus pull, no cascade.
- `S2`: Manège Extrême cardiac incident, Hugo primary, Marco backfills Z8.
- `S4`: Spanish report at Entrée, deterministic multilingual path.

## What P2 Covers

- Socket.io coordinator with frozen event names.
- Live state for agents, zones, headcount, surplus, assignments, incidents, constraints.
- Floyd-Warshall zone travel times.
- Skill-aware `safeToPull`.
- Backfill cascade capped at 2 hops.
- Deterministic fallback when Crusoe is unavailable.
- Ack loop with configurable timeout and auto-reroute.
- Agent reconnect handling with grace period and pending dispatch replay.
- SQLite incident, assignment, event, and learned-constraint persistence.
- Local static serving plus optional mkcert HTTPS.

