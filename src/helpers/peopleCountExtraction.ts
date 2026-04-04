/**
 * Extracción determinística de cantidad de personas/comensales (sin LLM).
 * Usada al reanudar el flujo cuando el usuario responde al prompt de personas.
 */
const WORD_NUMBERS: Record<string, number> = {
  uno: 1,
  una: 1,
  un: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

export function extractDeterministicPeopleCount(text: string): number | null {
  const t = text.trim();
  if (!t) return null;

  const standalone = t.match(/^\s*(\d{1,2})\s*$/);
  if (standalone) {
    const n = parseInt(standalone[1], 10);
    if (n >= 1 && n <= 99) return n;
  }

  const para = t.match(
    /\b(?:para|somos|entre)\s+(\d{1,2})\b/i
  );
  if (para) {
    const n = parseInt(para[1], 10);
    if (n >= 1 && n <= 99) return n;
  }

  const withPersonas = t.match(
    /(\d{1,2})\s*(?:personas?|pers\.?|gente|comensales?)\b/i
  );
  if (withPersonas) {
    const n = parseInt(withPersonas[1], 10);
    if (n >= 1 && n <= 99) return n;
  }

  const lower = t.toLowerCase();
  for (const [word, n] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(lower)) {
      return n;
    }
  }

  const anyDigit = t.match(/\b(\d{1,2})\b/);
  if (anyDigit) {
    const n = parseInt(anyDigit[1], 10);
    if (n >= 1 && n <= 99) return n;
  }

  return null;
}
