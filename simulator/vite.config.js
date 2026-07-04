import { defineConfig } from "vite";

// Servi par le coordinateur sous /sim (une seule origine, un seul WS). En dev standalone
// (npm run dev) on reste à la racine ; le coordinateur cible se passe via ?coordinator=URL.
export default defineConfig({
  base: process.env.SIM_BASE || "/sim/",
});
