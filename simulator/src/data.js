export const zoneSeed = [
  { id: "Z1", name: "Entry Gate", short: "Entry", requiredMin: 1, requiredSkills: [], pos: [-18, 0, 10], color: "#6ee7b7", adjacency: [{ z: "Z5", t: 60 }, { z: "Z10", t: 70 }] },
  { id: "Z2", name: "Grand Huit", short: "Coaster", requiredMin: 2, requiredSkills: ["RCP"], pos: [-12, 0, -8], color: "#60a5fa", adjacency: [{ z: "Z5", t: 90 }, { z: "Z8", t: 60 }] },
  { id: "Z3", name: "Ferris Wheel", short: "Wheel", requiredMin: 1, requiredSkills: [], pos: [0, 0, -13], color: "#f9a8d4", adjacency: [{ z: "Z5", t: 75 }, { z: "Z4", t: 85 }] },
  { id: "Z4", name: "Wild River", short: "River", requiredMin: 1, requiredSkills: ["RCP"], pos: [14, 0, -10], color: "#38bdf8", adjacency: [{ z: "Z3", t: 85 }, { z: "Z8", t: 70 }] },
  { id: "Z5", name: "Central Plaza", short: "Plaza", requiredMin: 2, requiredSkills: [], pos: [0, 0, 0], color: "#facc15", adjacency: [{ z: "Z1", t: 60 }, { z: "Z2", t: 90 }, { z: "Z3", t: 75 }, { z: "Z6", t: 80 }, { z: "Z7", t: 50 }, { z: "Z9", t: 55 }] },
  { id: "Z6", name: "Kids Zone", short: "Kids", requiredMin: 2, requiredSkills: [], pos: [11, 0, 8], color: "#fb7185", adjacency: [{ z: "Z5", t: 80 }, { z: "Z7", t: 65 }] },
  { id: "Z7", name: "Food Court", short: "Food", requiredMin: 1, requiredSkills: [], pos: [2, 0, 12], color: "#fdba74", adjacency: [{ z: "Z5", t: 50 }, { z: "Z6", t: 65 }, { z: "Z9", t: 40 }] },
  { id: "Z8", name: "Extreme Ride", short: "Extreme", requiredMin: 2, requiredSkills: ["RCP"], pos: [16, 0, -2], color: "#c084fc", adjacency: [{ z: "Z2", t: 60 }, { z: "Z4", t: 70 }] },
  { id: "Z9", name: "Shops", short: "Shops", requiredMin: 0, requiredSkills: [], pos: [-6, 0, 14], color: "#a3e635", adjacency: [{ z: "Z5", t: 55 }, { z: "Z7", t: 40 }] },
  { id: "Z10", name: "Parking", short: "Parking", requiredMin: 0, requiredSkills: [], pos: [-23, 0, 15], color: "#94a3b8", adjacency: [{ z: "Z1", t: 70 }] }
];

export const agentSeed = [
  { id: "A1", name: "Marco", skills: ["RCP", "DAE"], languages: ["fr", "en"], currentZone: "Z2", homeZone: "Z2", isReserve: false },
  { id: "A2", name: "Ana", skills: ["RCP"], languages: ["fr", "es"], currentZone: "Z2", homeZone: "Z2", isReserve: false },
  { id: "A3", name: "Karim", skills: ["secu"], languages: ["fr"], currentZone: "Z2", homeZone: "Z2", isReserve: false },
  { id: "A4", name: "Lea", skills: ["RCP", "medic"], languages: ["fr", "en"], currentZone: "Z5", homeZone: "Z5", isReserve: false },
  { id: "A5", name: "Tom", skills: ["DAE", "first-aid"], languages: ["fr"], currentZone: "Z5", homeZone: "Z5", isReserve: false },
  { id: "A6", name: "Sofia", skills: ["secu"], languages: ["fr", "es"], currentZone: "Z5", homeZone: "Z5", isReserve: false },
  { id: "A7", name: "Hugo", skills: ["RCP"], languages: ["fr"], currentZone: "Z8", homeZone: "Z8", isReserve: false },
  { id: "A8", name: "Nadia", skills: ["secu"], languages: ["fr", "en"], currentZone: "Z8", homeZone: "Z8", isReserve: false },
  { id: "A9", name: "Yanis", skills: ["first-aid"], languages: ["fr"], currentZone: "Z6", homeZone: "Z6", isReserve: false },
  { id: "A10", name: "Emma", skills: ["RCP", "medic"], languages: ["fr", "en"], currentZone: "Z6", homeZone: "Z6", isReserve: false },
  { id: "A11", name: "Louis", skills: ["RCP"], languages: ["fr"], currentZone: "Z4", homeZone: "Z4", isReserve: false },
  { id: "A12", name: "Chloe", skills: ["first-aid"], languages: ["fr"], currentZone: "Z7", homeZone: "Z7", isReserve: false },
  { id: "A13", name: "Sami", skills: ["secu"], languages: ["fr", "en"], currentZone: "Z1", homeZone: "Z1", isReserve: false },
  { id: "A14", name: "Ines", skills: ["first-aid"], languages: ["fr"], currentZone: "Z3", homeZone: "Z3", isReserve: false },
  { id: "R1", name: "Paul", skills: ["RCP", "DAE", "secu"], languages: ["fr", "en"], currentZone: "Z9", homeZone: null, isReserve: true },
  { id: "R2", name: "Lucia", skills: ["RCP", "medic"], languages: ["fr", "es"], currentZone: "Z7", homeZone: null, isReserve: true }
];

export const incidentCatalog = {
  Z1: { transcript: "Hay una persona en el suelo en la entrada, no responde.", language: "es", type: "unresponsive_guest", skills: ["RCP"], severity: 4 },
  Z2: { transcript: "Guest collapsed beside the Grand Huit queue, possible cardiac arrest.", language: "en", type: "cardiac_arrest", skills: ["RCP"], severity: 5 },
  Z3: { transcript: "Someone fell near the Ferris Wheel boarding gate and needs first aid.", language: "en", type: "fall_injury", skills: ["first-aid"], severity: 3 },
  Z4: { transcript: "Guest down near the Wild River bridge, breathing is unclear.", language: "en", type: "respiratory_distress", skills: ["RCP"], severity: 5 },
  Z5: { transcript: "Crowd surge at Central Plaza. Security support and first aid needed.", language: "en", type: "crowd_surge", skills: ["secu"], severity: 4 },
  Z6: { transcript: "Child collapsed in the Kids Zone. Send a medic now.", language: "en", type: "medical_collapse", skills: ["medic"], severity: 5 },
  Z7: { transcript: "Food court guest fainted, first aid required.", language: "en", type: "fainting", skills: ["first-aid"], severity: 3 },
  Z8: { transcript: "Guest collapsed at Extreme Ride exit. Possible no pulse.", language: "en", type: "cardiac_arrest", skills: ["RCP"], severity: 5 },
  Z9: { transcript: "Shop aisle fall, guest is conscious but bleeding.", language: "en", type: "bleeding_fall", skills: ["first-aid"], severity: 3 },
  Z10: { transcript: "Guest collapsed near parking shuttle bay.", language: "en", type: "medical_collapse", skills: ["RCP"], severity: 4 }
};
