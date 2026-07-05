import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// HTTPS local est requis : sans lui, l'API micro (getUserMedia) est bloquée
// par les navigateurs mobiles hors localhost. mkcert installe une autorité
// locale via sudo -> désactivable (VITE_DISABLE_HTTPS=true) dans les sandbox
///CI sans sudo interactif ; le dev réel sur laptop garde HTTPS par défaut.
const disableHttps = process.env.VITE_DISABLE_HTTPS === 'true'

export default defineConfig({
  plugins: [react(), !disableHttps && mkcert()].filter(Boolean),
  server: {
    https: !disableHttps,
    host: true, // écoute sur 0.0.0.0 pour être joignable depuis les téléphones du réseau local
  },
})
