export async function transcribe(input, config = {}) {
  if (input?.transcript) {
    return {
      text: input.transcript,
      lang: input.lang || "fr"
    };
  }

  if (config.useMocks || !config.gradium?.apiKey) {
    return {
      text: "arrêt cardiaque au manège extrême, il ne respire plus",
      lang: "fr"
    };
  }

  throw new Error("Gradium real STT is intentionally left behind the P3 integration interface.");
}

export async function speak(text, lang, config = {}) {
  if (config.useMocks || !config.gradium?.apiKey) {
    return {
      audioUrl: "/mock/tts-sample.mp3"
    };
  }

  throw new Error("Gradium real TTS is intentionally left behind the P3 integration interface.");
}

