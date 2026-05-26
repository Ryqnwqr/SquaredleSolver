/** https://dictionaryapi.dev — free, no API key, CORS-enabled. */

export interface DefinitionLine {
  text: string;
  example?: string;
}

export interface DictionarySense {
  partOfSpeech: string;
  definitions: DefinitionLine[];
}

export interface DictionaryEntry {
  word: string;
  phonetic?: string;
  senses: DictionarySense[];
}

interface ApiDefinition {
  definition?: string;
  example?: string;
}

interface ApiMeaning {
  partOfSpeech?: string;
  definitions?: ApiDefinition[];
}

interface ApiEntry {
  word?: string;
  phonetics?: Array<{ text?: string }>;
  meanings?: ApiMeaning[];
}

const API_BASE = "https://api.dictionaryapi.dev/api/v2/entries/en";

function pickPhonetic(entry: ApiEntry): string | undefined {
  for (const p of entry.phonetics ?? []) {
    const t = p.text?.trim();
    if (t) return t;
  }
  return undefined;
}

function parseEntry(data: ApiEntry): DictionaryEntry | null {
  const word = data.word?.trim();
  if (!word) return null;

  const senses: DictionarySense[] = [];
  for (const meaning of data.meanings ?? []) {
    const partOfSpeech = meaning.partOfSpeech?.trim();
    if (!partOfSpeech) continue;

    const definitions: DefinitionLine[] = [];
    for (const def of meaning.definitions ?? []) {
      const text = def.definition?.trim();
      if (!text) continue;
      definitions.push({
        text,
        example: def.example?.trim() || undefined,
      });
      if (definitions.length >= 3) break;
    }
    if (definitions.length === 0) continue;
    senses.push({ partOfSpeech, definitions });
    if (senses.length >= 4) break;
  }

  if (senses.length === 0) return null;

  return {
    word,
    phonetic: pickPhonetic(data),
    senses,
  };
}

export async function lookupWord(
  word: string,
  signal?: AbortSignal
): Promise<DictionaryEntry | null> {
  const q = word.trim().toLowerCase();
  if (!q) return null;

  const res = await fetch(`${API_BASE}/${encodeURIComponent(q)}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Dictionary lookup failed (${res.status})`);
  }

  const json = (await res.json()) as ApiEntry[];
  const first = json[0];
  if (!first) return null;
  return parseEntry(first);
}

/** Display label for API part-of-speech strings. */
export function formatPartOfSpeech(pos: string): string {
  const key = pos.toLowerCase().replace(/\s+/g, " ").trim();
  const short: Record<string, string> = {
    noun: "noun",
    verb: "verb",
    adjective: "adj.",
    adverb: "adv.",
    pronoun: "pron.",
    preposition: "prep.",
    conjunction: "conj.",
    interjection: "interj.",
    determiner: "det.",
    exclamation: "excl.",
  };
  return short[key] ?? pos;
}
