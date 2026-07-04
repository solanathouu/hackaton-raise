# Crusoe × CONDUCTOR (P5)

Référence rapide pour le workflow réel. Source complète : skill hackathon `CRUSOE.md`.

## Setup

```bash
# .env — clé entre SINGLE QUOTES (contient des $)
CRUSOE_API_KEY='...'
CRUSOE_BASE_URL=https://api.inference.crusoecloud.com/v1/
CRUSOE_MODEL=deepseek-ai/Deepseek-V4-Flash
CRUSOE_MODEL_FALLBACK=nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B
USE_MOCKS=false
```

## Modèles autorisés (allowlist stricte)

| Modèle | Rôle CONDUCTOR |
|--------|----------------|
| `deepseek-ai/Deepseek-V4-Flash` | **Primary** — JSON dispatch, FR/ES, ~3–5s |
| `nvidia/Nemotron-3-Nano-Omni-Reasoning-30B-A3B` | Fallback LLM (EN only côté Nemotron — préférer DeepSeek primary) |
| `google/gemma-4-31b-it` | Alternative structured output sans disable thinking |
| `moonshotai/Kimi-K2.6` | Long contexte (256K) — nécessite `thinking: false` pour JSON |
| `nvidia/NVIDIA-Nemotron-3-Ultra-550B` | Qualité max, plus lent — backup démo si Flash down |

`openai/gpt-oss-120b` = **payant**, hors allowlist hackathon.

## Règles critiques (skill §3, adaptées CONDUCTOR)

1. **JSON structuré** → `response_format: { type: 'json_object' }` + `temperature: 0.2`
   - Sur l'API managed hackathon, `extra_body.chat_template_kwargs` (disable thinking) → **403**. Ne pas l'utiliser.
   - DeepSeek Flash et Nemotron Nano produisent du JSON valide sans ce flag (testé live).
2. **Gemma 4** → meilleur choix si JSON instable (pas de thinking overhead)
3. **System prompt stable** → bénéficie du prompt caching MemoryAlloy
4. **max_tokens** → cap ~1024 (decision JSON petite)
5. **401** → clé entre **single quotes** dans `.env` (contient des `$`)

## Commandes

```bash
npm run smoke:crusoe    # test JSON + latence
npm start               # pré-chauffe Crusoe au boot si USE_MOCKS=false
curl localhost:3000/health  # vérif modèles actifs + allowlist
```

## Pipeline CONDUCTOR

```
transcript → buildSnapshot → decide() [Crusoe JSON] → applyDecision() [moteur]
```

Le LLM **propose** ; le moteur **valide et répare**. Fallback déterministe si Crusoe down.

## Troubleshooting

| Erreur | Fix |
|--------|-----|
| JSON vide / `{}` | Thinking activé → vérifier `extra_body` dans `crusoe.js` |
| 401 bad_credential | Clé mal quotée ou expirée |
| 404 model not found | ID exact requis (voir allowlist) |
| 412 no servers | Attendre 30–60s, retry |
| Latence >3s | `prewarmCrusoe()` au boot (déjà câblé) |
