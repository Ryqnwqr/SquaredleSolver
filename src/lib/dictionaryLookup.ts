/** Definition lookups: Free Dictionary API + Wiktionary (Wikimedia REST). */

export type DictionarySource = "freeDictionary" | "wiktionary";

export const DICTIONARY_SOURCE_LABELS: Record<DictionarySource, string> = {
  freeDictionary: "Free Dictionary API",
  wiktionary: "Wiktionary",
};

export function otherDictionarySource(
  source: DictionarySource
): DictionarySource {
  return source === "freeDictionary" ? "wiktionary" : "freeDictionary";
}

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
  source: DictionarySource;
  sourceLabel: string;
}

export interface LookupResult {
  entry: DictionaryEntry;
  /** True when the non-selected source supplied the entry. */
  usedFallback: boolean;
}

const FREE_DICTIONARY_API =
  "https://api.dictionaryapi.dev/api/v2/entries/en";
const WIKTIONARY_API =
  "https://en.wiktionary.org/api/rest_v1/page/definition";

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

interface WiktionaryDef {
  definition?: string;
  examples?: string[];
  parsedExamples?: Array<{ example?: string }>;
}

interface WiktionarySense {
  partOfSpeech?: string;
  language?: string;
  definitions?: WiktionaryDef[];
}

type WiktionaryResponse = Record<string, WiktionarySense[]>;

function pickPhonetic(entry: ApiEntry): string | undefined {
  for (const p of entry.phonetics ?? []) {
    const t = p.text?.trim();
    if (t) return t;
  }
  return undefined;
}

function stripHtml(html: string): string {
  if (!html.includes("<")) return html.trim();
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseFreeDictionaryEntry(data: ApiEntry): DictionaryEntry | null {
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
    source: "freeDictionary",
    sourceLabel: DICTIONARY_SOURCE_LABELS.freeDictionary,
  };
}

function parseWiktionaryEntry(
  word: string,
  data: WiktionaryResponse
): DictionaryEntry | null {
  const senses: DictionarySense[] = [];
  const english = data.en ?? [];

  for (const block of english) {
    const partOfSpeech = block.partOfSpeech?.trim();
    if (!partOfSpeech) continue;

    const definitions: DefinitionLine[] = [];
    for (const def of block.definitions ?? []) {
      const text = stripHtml(def.definition ?? "");
      if (!text) continue;

      let example: string | undefined;
      const rawEx =
        def.parsedExamples?.[0]?.example ??
        def.examples?.[0];
      if (rawEx) {
        const cleaned = stripHtml(rawEx);
        if (cleaned) example = cleaned;
      }

      definitions.push({ text, example });
      if (definitions.length >= 3) break;
    }
    if (definitions.length === 0) continue;
    senses.push({ partOfSpeech, definitions });
    if (senses.length >= 4) break;
  }

  if (senses.length === 0) return null;

  return {
    word,
    senses,
    source: "wiktionary",
    sourceLabel: DICTIONARY_SOURCE_LABELS.wiktionary,
  };
}

async function lookupFreeDictionary(
  word: string,
  signal?: AbortSignal
): Promise<DictionaryEntry | null> {
  const q = word.trim().toLowerCase();
  if (!q) return null;

  const res = await fetch(`${FREE_DICTIONARY_API}/${encodeURIComponent(q)}`, {
    signal,
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Free Dictionary API failed (${res.status})`);
  }

  const json = (await res.json()) as ApiEntry[];
  const first = json[0];
  if (!first) return null;
  return parseFreeDictionaryEntry(first);
}

async function lookupWiktionary(
  word: string,
  signal?: AbortSignal
): Promise<DictionaryEntry | null> {
  const q = word.trim();
  if (!q) return null;

  const res = await fetch(
    `${WIKTIONARY_API}/${encodeURIComponent(q)}`,
    { signal, headers: { Accept: "application/json" } }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Wiktionary lookup failed (${res.status})`);
  }

  const json = (await res.json()) as WiktionaryResponse;
  return parseWiktionaryEntry(q, json);
}

const LOOKUP_BY_SOURCE: Record<
  DictionarySource,
  (word: string, signal?: AbortSignal) => Promise<DictionaryEntry | null>
> = {
  freeDictionary: lookupFreeDictionary,
  wiktionary: lookupWiktionary,
};

async function lookupFromSource(
  source: DictionarySource,
  word: string,
  signal?: AbortSignal
): Promise<DictionaryEntry | null> {
  try {
    return await LOOKUP_BY_SOURCE[source](word, signal);
  } catch {
    return null;
  }
}

/** Try primary source, then the other if the primary has no entry. */
export async function lookupWithFallback(
  word: string,
  primary: DictionarySource,
  signal?: AbortSignal
): Promise<LookupResult | null> {
  const secondary = otherDictionarySource(primary);
  const order: DictionarySource[] = [primary, secondary];

  for (let i = 0; i < order.length; i++) {
    const source = order[i];
    const entry = await lookupFromSource(source, word, signal);
    if (signal?.aborted) return null;
    if (entry) {
      return {
        entry,
        usedFallback: i > 0,
      };
    }
  }

  return null;
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
