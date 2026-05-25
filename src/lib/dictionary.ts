import { Trie } from "./trie";

export const MIN_LENGTH = 4;

export type DictionaryMode = "nwl2023" | "english";

export const DICTIONARY_LABELS: Record<DictionaryMode, string> = {
  nwl2023: "Squaredle (NWL2023)",
  english: "All English words",
};

const trieCache = new Map<DictionaryMode, Promise<Trie>>();

function buildTrieFromWords(words: Iterable<string>): Trie {
  const trie = new Trie();
  for (const raw of words) {
    const word = raw.toLowerCase().replace(/[^a-z]/g, "");
    if (word.length >= MIN_LENGTH) {
      trie.insert(word);
    }
  }
  return trie;
}

async function buildTrie(mode: DictionaryMode): Promise<Trie> {
  if (mode === "nwl2023") {
    const res = await fetch("/nwl2023.json");
    if (!res.ok) {
      throw new Error("Failed to load NWL2023 word list");
    }
    const words: string[] = await res.json();
    return buildTrieFromWords(words);
  }

  const { default: words } = await import("an-array-of-english-words");
  return buildTrieFromWords(words);
}

export function loadDictionary(mode: DictionaryMode = "nwl2023"): Promise<Trie> {
  let promise = trieCache.get(mode);
  if (!promise) {
    promise = buildTrie(mode);
    trieCache.set(mode, promise);
  }
  return promise;
}

export function clearDictionaryCache(): void {
  trieCache.clear();
}
