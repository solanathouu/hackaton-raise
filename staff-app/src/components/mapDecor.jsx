// Fond de plan "terrain" statique, façon fond de carte Google Maps : sol du
// parc, pelouses, rivière, esplanade, parking, bâtiments et arbres. Dessiné
// une seule fois sous les allées et les zones — purement passif (aucun
// pointer-event), toutes les coordonnées sont calées sur zones.json.

export function MapDecor() {
  return (
    <g className="map-decor" aria-hidden="true">
      {/* Sol du parc (enceinte) */}
      <rect x="90" y="50" width="740" height="520" rx="42" className="map-decor__ground" />
      {/* Esplanade d'entrée (Z1) qui relie l'enceinte au parvis */}
      <rect x="370" y="540" width="160" height="78" rx="18" className="map-decor__ground" />

      {/* Pelouses */}
      <ellipse cx="265" cy="135" rx="185" ry="82" className="map-decor__lawn" />
      <ellipse cx="170" cy="398" rx="95" ry="72" className="map-decor__lawn" />
      <ellipse cx="600" cy="255" rx="105" ry="62" className="map-decor__lawn" />
      <ellipse cx="420" cy="470" rx="70" ry="40" className="map-decor__lawn" />

      {/* Rivière (traverse la zone Z4 « Rivière Sauvage ») */}
      <path
        d="M858 92 C 770 170, 736 258, 778 342 S 846 470, 796 556"
        className="map-decor__water"
      />
      <path
        d="M858 92 C 770 170, 736 258, 778 342 S 846 470, 796 556"
        className="map-decor__water-inner"
      />

      {/* Place Centrale (Z5) : parvis circulaire pavé */}
      <circle cx="450" cy="350" r="54" className="map-decor__plaza" />
      <circle cx="450" cy="350" r="40" className="map-decor__plaza-inner" />

      {/* Parking (Z10) */}
      <g className="map-decor__parking">
        <rect x="588" y="558" width="134" height="72" rx="8" />
        <g className="map-decor__parking-lines">
          <line x1="610" y1="566" x2="610" y2="588" />
          <line x1="636" y1="566" x2="636" y2="588" />
          <line x1="662" y1="566" x2="662" y2="588" />
          <line x1="688" y1="566" x2="688" y2="588" />
          <line x1="610" y1="600" x2="610" y2="622" />
          <line x1="636" y1="600" x2="636" y2="622" />
          <line x1="662" y1="600" x2="662" y2="622" />
          <line x1="688" y1="600" x2="688" y2="622" />
        </g>
      </g>

      {/* Bâtiments : stands du Food Court (Z7) */}
      <g className="map-decor__buildings">
        <rect x="228" y="458" width="30" height="21" rx="3" />
        <rect x="314" y="468" width="27" height="19" rx="3" />
        <rect x="246" y="524" width="32" height="17" rx="3" />
        {/* Boutiques (Z9) */}
        <rect x="502" y="524" width="27" height="19" rx="3" />
        <rect x="536" y="530" width="27" height="19" rx="3" />
        <rect x="576" y="520" width="25" height="17" rx="3" />
        {/* Portique d'entrée (Z1) */}
        <rect x="404" y="560" width="19" height="15" rx="3" />
        <rect x="477" y="560" width="19" height="15" rx="3" />
      </g>

      {/* Arbres */}
      <g className="map-decor__trees">
        <circle cx="138" cy="225" r="7" />
        <circle cx="120" cy="300" r="6" />
        <circle cx="330" cy="295" r="7" />
        <circle cx="360" cy="430" r="6" />
        <circle cx="545" cy="120" r="7" />
        <circle cx="590" cy="410" r="6" />
        <circle cx="660" cy="470" r="7" />
        <circle cx="250" cy="250" r="6" />
        <circle cx="480" cy="230" r="6" />
        <circle cx="150" cy="500" r="6" />
        <circle cx="700" cy="120" r="6" />
      </g>
    </g>
  )
}
