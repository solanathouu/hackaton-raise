// lang.js — Détection de langue déterministe (fr/en/es) par scoring de mots-outils.
// POURQUOI : le STT Gradium ne renvoie PAS la langue détectée (vérifié docs NDJSON).
// Le Contrat D promet { text, lang } -> quand l'app n'envoie pas de hint, on détecte
// ici. Zéro réseau, zéro LLM, déterministe (rejouable 10x en démo).

const STOPWORDS = {
  fr: ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'au', 'il', 'elle', 'est', 'ne',
    'pas', 'plus', 'sur', 'dans', 'avec', 'pour', 'que', 'qui', 'et', 'respire',
    'par', 'terre', 'malaise', 'arrêt', 'cardiaque', 'grand', 'huit'],
  en: ['the', 'a', 'an', 'is', 'not', 'he', 'she', 'it', 'on', 'in', 'with', 'for',
    'that', 'who', 'and', 'breathing', 'down', 'man', 'someone', 'collapsed',
    'help', 'at', 'ride'],
  es: ['el', 'los', 'las', 'una', 'es', 'no', 'se', 'en', 'con', 'para', 'quien',
    'y', 'respira', 'hombre', 'desplomó', 'ayuda', 'está', 'suelo', 'cerca',
    'entrada'],
};

export function detectLang(text, fallback = 'fr') {
  if (!text || typeof text !== 'string') return fallback;
  const words = text.toLowerCase().normalize('NFC').split(/[^\p{L}']+/u).filter(Boolean);
  if (!words.length) return fallback;

  const scores = { fr: 0, en: 0, es: 0 };
  for (const w of words) {
    for (const [lang, list] of Object.entries(STOPWORDS)) {
      if (list.includes(w)) scores[lang] += 1;
    }
  }
  // Accents typiques en départage fr/es.
  if (/[àâçèêëîôû]/.test(text.toLowerCase())) scores.fr += 1;
  if (/[áíóúñ¿¡]/.test(text.toLowerCase())) scores.es += 1;

  const [best, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return score > 0 ? best : fallback;
}
