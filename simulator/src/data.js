// data.js — seed du simulateur, ALIGNÉ sur data/zones.json + data/roster.json du coordinateur
// (mêmes IDs, mêmes minima, mêmes adjacences pondérées). Les positions 3D (pos) et couleurs
// sont propres à la vue. Noms français = ceux que le vrai `state` du cerveau renvoie.
export const zoneSeed = [
  { id: "Z1", name: "Entrée", short: "Entrée", requiredMin: 1, requiredSkills: [], pos: [-18, 0, 10], color: "#6ee7b7", adjacency: [{ z: "Z5", t: 60 }, { z: "Z10", t: 70 }] },
  { id: "Z2", name: "Grand Huit", short: "Gd Huit", requiredMin: 2, requiredSkills: ["RCP"], pos: [-12, 0, -8], color: "#60a5fa", adjacency: [{ z: "Z5", t: 90 }, { z: "Z8", t: 60 }] },
  { id: "Z3", name: "Grande Roue", short: "Roue", requiredMin: 1, requiredSkills: [], pos: [0, 0, -13], color: "#f9a8d4", adjacency: [{ z: "Z5", t: 75 }, { z: "Z4", t: 85 }] },
  { id: "Z4", name: "Rivière Sauvage", short: "Rivière", requiredMin: 1, requiredSkills: ["RCP"], pos: [14, 0, -10], color: "#38bdf8", adjacency: [{ z: "Z3", t: 85 }, { z: "Z8", t: 70 }] },
  { id: "Z5", name: "Place Centrale", short: "Place", requiredMin: 2, requiredSkills: [], pos: [0, 0, 0], color: "#facc15", adjacency: [{ z: "Z1", t: 60 }, { z: "Z2", t: 90 }, { z: "Z3", t: 75 }, { z: "Z6", t: 80 }, { z: "Z7", t: 50 }, { z: "Z9", t: 55 }] },
  { id: "Z6", name: "Zone Enfants", short: "Enfants", requiredMin: 2, requiredSkills: [], pos: [11, 0, 8], color: "#fb7185", adjacency: [{ z: "Z5", t: 80 }, { z: "Z7", t: 65 }] },
  { id: "Z7", name: "Food Court", short: "Food", requiredMin: 1, requiredSkills: [], pos: [2, 0, 12], color: "#fdba74", adjacency: [{ z: "Z5", t: 50 }, { z: "Z6", t: 65 }, { z: "Z9", t: 40 }] },
  { id: "Z8", name: "Manège Extrême", short: "Extrême", requiredMin: 2, requiredSkills: ["RCP"], pos: [16, 0, -2], color: "#c084fc", adjacency: [{ z: "Z2", t: 60 }, { z: "Z4", t: 70 }] },
  { id: "Z9", name: "Boutiques", short: "Boutiques", requiredMin: 0, requiredSkills: [], pos: [-6, 0, 14], color: "#a3e635", adjacency: [{ z: "Z5", t: 55 }, { z: "Z7", t: 40 }] },
  { id: "Z10", name: "Parking", short: "Parking", requiredMin: 0, requiredSkills: [], pos: [-23, 0, 15], color: "#94a3b8", adjacency: [{ z: "Z1", t: 70 }] }
];

export const agentSeed = [
  { id: "A1", name: "Marco", skills: ["RCP", "DAE"], languages: ["fr", "en"], currentZone: "Z2", homeZone: "Z2", isReserve: false },
  { id: "A2", name: "Ana", skills: ["RCP"], languages: ["fr", "es"], currentZone: "Z2", homeZone: "Z2", isReserve: false },
  { id: "A3", name: "Karim", skills: ["secu"], languages: ["fr"], currentZone: "Z2", homeZone: "Z2", isReserve: false },
  { id: "A4", name: "Léa", skills: ["RCP", "medic"], languages: ["fr", "en"], currentZone: "Z5", homeZone: "Z5", isReserve: false },
  { id: "A5", name: "Tom", skills: ["DAE", "first-aid"], languages: ["fr"], currentZone: "Z5", homeZone: "Z5", isReserve: false },
  { id: "A6", name: "Sofia", skills: ["secu"], languages: ["fr", "es"], currentZone: "Z5", homeZone: "Z5", isReserve: false },
  { id: "A7", name: "Hugo", skills: ["RCP"], languages: ["fr"], currentZone: "Z8", homeZone: "Z8", isReserve: false },
  { id: "A8", name: "Nadia", skills: ["secu"], languages: ["fr", "en"], currentZone: "Z8", homeZone: "Z8", isReserve: false },
  { id: "A9", name: "Yanis", skills: ["first-aid"], languages: ["fr"], currentZone: "Z6", homeZone: "Z6", isReserve: false },
  { id: "A10", name: "Emma", skills: ["RCP", "medic"], languages: ["fr", "en"], currentZone: "Z6", homeZone: "Z6", isReserve: false },
  { id: "A11", name: "Louis", skills: ["RCP"], languages: ["fr"], currentZone: "Z4", homeZone: "Z4", isReserve: false },
  { id: "A12", name: "Chloé", skills: ["first-aid"], languages: ["fr"], currentZone: "Z7", homeZone: "Z7", isReserve: false },
  { id: "A13", name: "Sami", skills: ["secu"], languages: ["fr", "en"], currentZone: "Z1", homeZone: "Z1", isReserve: false },
  { id: "A14", name: "Inès", skills: ["first-aid"], languages: ["fr"], currentZone: "Z3", homeZone: "Z3", isReserve: false },
  { id: "R1", name: "Paul", skills: ["RCP", "DAE", "secu"], languages: ["fr", "en"], currentZone: "Z9", homeZone: null, isReserve: true },
  { id: "R2", name: "Lucia", skills: ["RCP", "medic"], languages: ["fr", "es"], currentZone: "Z7", homeZone: null, isReserve: true }
];

// Transcripts alignés sur les scénarios réels S1-S4 du coordinateur (mêmes phrases) pour que le
// mode demo raconte la même histoire que le mode live.
export const incidentCatalog = {
  Z1: { transcript: "Un hombre se desplomó en la entrada, no respira.", language: "es", type: "arrêt cardiaque", skills: ["RCP"], severity: 5 },
  Z2: { transcript: "Malaise au Grand Huit, une personne au sol.", language: "fr", type: "malaise", skills: ["RCP"], severity: 3 },
  Z3: { transcript: "Chute près de l'embarquement de la Grande Roue.", language: "fr", type: "chute", skills: ["first-aid"], severity: 3 },
  Z4: { transcript: "Personne au sol près du pont de la Rivière Sauvage, respiration incertaine.", language: "fr", type: "détresse respiratoire", skills: ["RCP"], severity: 5 },
  Z5: { transcript: "Mouvement de foule Place Centrale, besoin de sécurité et premiers secours.", language: "fr", type: "montée de foule", skills: ["secu"], severity: 4 },
  Z6: { transcript: "Malaise à la Zone Enfants, personne inconsciente.", language: "fr", type: "malaise", skills: ["medic"], severity: 5 },
  Z7: { transcript: "Un visiteur s'est évanoui au Food Court.", language: "fr", type: "malaise", skills: ["first-aid"], severity: 3 },
  Z8: { transcript: "Arrêt cardiaque au Manège Extrême, il ne respire plus.", language: "fr", type: "arrêt cardiaque", skills: ["RCP"], severity: 5 },
  Z9: { transcript: "Chute dans une allée des Boutiques, personne consciente mais blessée.", language: "fr", type: "chute", skills: ["first-aid"], severity: 3 },
  Z10: { transcript: "Personne effondrée près de la navette du Parking.", language: "fr", type: "malaise", skills: ["RCP"], severity: 4 }
};
