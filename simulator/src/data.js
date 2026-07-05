// data.js — seed du simulateur, ALIGNÉ sur data/zones.json + data/roster.json du coordinateur
// (mêmes IDs, mêmes minima, mêmes adjacences pondérées). Les positions 3D (pos) et couleurs
// sont propres à la vue. Noms français = ceux que le vrai `state` du cerveau renvoie.
export const zoneSeed = [
  { id: "Z1", name: "Entrance", short: "Entrance", requiredMin: 1, requiredSkills: [], pos: [-18, 0, 10], color: "#6ee7b7", adjacency: [{ z: "Z5", t: 60 }, { z: "Z10", t: 70 }] },
  { id: "Z2", name: "Roller Coaster", short: "Coaster", requiredMin: 2, requiredSkills: ["RCP"], pos: [-12, 0, -8], color: "#60a5fa", adjacency: [{ z: "Z5", t: 90 }, { z: "Z8", t: 60 }] },
  { id: "Z3", name: "Ferris Wheel", short: "Wheel", requiredMin: 1, requiredSkills: [], pos: [0, 0, -13], color: "#f9a8d4", adjacency: [{ z: "Z5", t: 75 }, { z: "Z4", t: 85 }] },
  { id: "Z4", name: "Wild River", short: "River", requiredMin: 1, requiredSkills: ["RCP"], pos: [14, 0, -10], color: "#38bdf8", adjacency: [{ z: "Z3", t: 85 }, { z: "Z8", t: 70 }] },
  { id: "Z5", name: "Central Plaza", short: "Plaza", requiredMin: 2, requiredSkills: [], pos: [0, 0, 0], color: "#facc15", adjacency: [{ z: "Z1", t: 60 }, { z: "Z2", t: 90 }, { z: "Z3", t: 75 }, { z: "Z6", t: 80 }, { z: "Z7", t: 50 }, { z: "Z9", t: 55 }] },
  { id: "Z6", name: "Kids Zone", short: "Kids", requiredMin: 2, requiredSkills: [], pos: [11, 0, 8], color: "#fb7185", adjacency: [{ z: "Z5", t: 80 }, { z: "Z7", t: 65 }] },
  { id: "Z7", name: "Food Court", short: "Food", requiredMin: 1, requiredSkills: [], pos: [2, 0, 12], color: "#fdba74", adjacency: [{ z: "Z5", t: 50 }, { z: "Z6", t: 65 }, { z: "Z9", t: 40 }] },
  { id: "Z8", name: "Extreme Ride", short: "Extreme", requiredMin: 1, requiredSkills: ["RCP"], pos: [16, 0, -2], color: "#c084fc", adjacency: [{ z: "Z2", t: 60 }, { z: "Z4", t: 70 }] },
  { id: "Z9", name: "Shops", short: "Shops", requiredMin: 0, requiredSkills: [], pos: [-6, 0, 14], color: "#a3e635", adjacency: [{ z: "Z5", t: 55 }, { z: "Z7", t: 40 }] },
  { id: "Z10", name: "Parking", short: "Parking", requiredMin: 0, requiredSkills: [], pos: [-23, 0, 15], color: "#94a3b8", adjacency: [{ z: "Z1", t: 70 }] }
];

export const agentSeed = [
  { id: "BASTEN", name: "Basten", skills: ["RCP", "first-aid"], languages: ["en"], currentZone: "Z8", homeZone: "Z8", isReserve: false },
  { id: "NATHAN", name: "Nathan", skills: ["RCP", "DAE"], languages: ["en"], currentZone: "Z5", homeZone: "Z5", isReserve: false },
  { id: "ALI", name: "Ali", skills: ["RCP", "medic"], languages: ["en"], currentZone: "Z5", homeZone: "Z5", isReserve: false }
];

// Transcripts alignés sur les scénarios réels S1-S4 du coordinateur (mêmes phrases) pour que le
// mode demo raconte la même histoire que le mode live.
export const incidentCatalog = {
  Z1: { transcript: "A man collapsed at the entrance, he is not breathing.", language: "en", type: "cardiac arrest", skills: ["RCP"], severity: 5 },
  Z2: { transcript: "Collapse at the roller coaster, a person on the ground.", language: "fr", type: "collapse", skills: ["RCP"], severity: 3 },
  Z3: { transcript: "Fall near the ferris wheel boarding area.", language: "fr", type: "fall", skills: ["first-aid"], severity: 3 },
  Z4: { transcript: "Person on the ground near the wild river bridge, breathing uncertain.", language: "fr", type: "respiratory distress", skills: ["RCP"], severity: 5 },
  Z5: { transcript: "Crowd surge at the central plaza, security and first aid needed.", language: "fr", type: "crowd surge", skills: ["secu"], severity: 4 },
  Z6: { transcript: "Collapse in the kids zone, person unconscious.", language: "fr", type: "collapse", skills: ["medic"], severity: 5 },
  Z7: { transcript: "A visitor has fainted at the food court.", language: "fr", type: "collapse", skills: ["first-aid"], severity: 3 },
  Z8: { transcript: "Cardiac arrest at the extreme ride, he's not breathing.", language: "fr", type: "cardiac arrest", skills: ["RCP"], severity: 5 },
  Z9: { transcript: "Fall in a shops aisle, person conscious but injured.", language: "fr", type: "fall", skills: ["first-aid"], severity: 3 },
  Z10: { transcript: "Person collapsed near the parking shuttle.", language: "fr", type: "collapse", skills: ["RCP"], severity: 4 }
};
