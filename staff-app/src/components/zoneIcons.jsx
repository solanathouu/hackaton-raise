// Glyphes minimalistes par zone (section 4 de la charte graphique).
// Traits simples, `currentColor` pour hériter du rouge fonctionnel du parent.

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const GLYPHS = {
  Z1: (
    // Entrée — porte + flèche
    <>
      <path d="M6 4v12" {...strokeProps} />
      <path d="M9 6l5 4-5 4" {...strokeProps} />
    </>
  ),
  Z2: (
    // Grand Huit — ligne de montagnes russes
    <path d="M3 14c2-6 3-6 4 0s2 6 3 0 2-6 3 0 2 6 4 0" {...strokeProps} />
  ),
  Z3: (
    // Grande Roue — roue à rayons
    <>
      <circle cx="10" cy="10" r="7" {...strokeProps} />
      <path d="M10 3v14M3 10h14M5 5l10 10M15 5L5 15" {...strokeProps} />
    </>
  ),
  Z4: (
    // Rivière Sauvage — vague
    <path d="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0" {...strokeProps} />
  ),
  Z5: (
    // Place Centrale — étoile
    <path d="M10 2l2.2 5.8L18 9l-4.6 3.6L14.8 18 10 14.6 5.2 18l1.4-5.4L2 9l5.8-1.2z" {...strokeProps} />
  ),
  Z6: (
    // Zone Enfants — silhouette parent-enfant
    <>
      <circle cx="7" cy="6" r="2" {...strokeProps} />
      <path d="M3 16c0-3 2-5 4-5s4 2 4 5" {...strokeProps} />
      <circle cx="14.5" cy="9" r="1.4" {...strokeProps} />
      <path d="M12 16c0-2 1-3.5 2.5-3.5S17 14 17 16" {...strokeProps} />
    </>
  ),
  Z7: (
    // Food Court — couverts
    <>
      <path d="M6 3v6M4.5 3v4.5a1.5 1.5 0 003 0V3M6 9v8" {...strokeProps} />
      <path d="M14 3c-1.5 0-2 2-2 4s.5 3 2 3v7" {...strokeProps} />
    </>
  ),
  Z8: (
    // Manège Extrême — éclair
    <path d="M11 2L4 12h5l-1 6 8-11h-5z" {...strokeProps} />
  ),
  Z9: (
    // Boutiques — sac
    <>
      <path d="M5 7h10l-1 11H6z" {...strokeProps} />
      <path d="M7.5 7V5a2.5 2.5 0 015 0v2" {...strokeProps} />
    </>
  ),
  Z10: (
    // Parking — voiture
    <>
      <path d="M3 13l1.5-5A2 2 0 016.4 6.5h7.2a2 2 0 011.9 1.5L17 13" {...strokeProps} />
      <rect x="2.5" y="13" width="15" height="4" rx="1" {...strokeProps} />
      <circle cx="6" cy="17" r="1.2" {...strokeProps} />
      <circle cx="14" cy="17" r="1.2" {...strokeProps} />
    </>
  ),
}

export function ZoneIcon({ zoneId, size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      {GLYPHS[zoneId] ?? <circle cx="10" cy="10" r="3" fill="currentColor" />}
    </svg>
  )
}

// Marqueur générique d'incident actif (le contrat WS ne transmet pas le
// incident_type au client — juste texte + zone), donc un seul glyphe
// "alerte" plutôt qu'une distinction cœur/croix/bouclier non réalisable
// sans cette donnée.
export function IncidentIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" {...strokeProps} />
      <path d="M10 6v5" {...strokeProps} />
      <circle cx="10" cy="14" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}
