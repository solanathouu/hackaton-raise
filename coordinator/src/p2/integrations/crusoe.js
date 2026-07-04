import { decideDeterministically } from "../engine.js";

function extractJson(content) {
  if (!content) throw new Error("Empty Crusoe response");
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Crusoe response did not contain JSON");
  return JSON.parse(match[0]);
}

export async function decide(snapshot, transcript, config = {}) {
  if (config.useMocks || !config.crusoe?.apiKey) {
    return {
      decision: decideDeterministically(snapshot),
      source: config.useMocks ? "mock-deterministic" : "deterministic-no-crusoe-key"
    };
  }

  const response = await fetch(`${config.crusoe.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.crusoe.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.crusoe.model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Tu es le coordinateur de dispatch d'un site. Reponds uniquement en JSON strict. Ne donne jamais de conseil medical. Choisis un primary qualifie et les backfills sans violer les minimums."
        },
        {
          role: "user",
          content: JSON.stringify({ snapshot, transcript })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Crusoe request failed: ${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  return {
    decision: extractJson(content),
    source: "crusoe"
  };
}
