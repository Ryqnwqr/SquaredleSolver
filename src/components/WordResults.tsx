import type { DictionarySource } from "../lib/dictionaryLookup";
import type { FoundWord } from "../lib/solver";
import { WordDefinition } from "./WordDefinition";
import { WordListLoader } from "./WordListLoader";

interface WordResultsProps {
  words: FoundWord[];
  selectedWord: FoundWord | null;
  onSelect: (word: FoundWord | null) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  definitionSource: DictionarySource;
  onDefinitionSourceChange: (source: DictionarySource) => void;
  loading?: boolean;
}

export function WordResults({
  words,
  selectedWord,
  onSelect,
  filter,
  onFilterChange,
  definitionSource,
  onDefinitionSourceChange,
  loading = false,
}: WordResultsProps) {
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? words.filter((w) => w.word.includes(q))
    : words;

  const byLength = filtered.reduce<Record<number, FoundWord[]>>((acc, w) => {
    const len = w.word.length;
    if (!acc[len]) acc[len] = [];
    acc[len].push(w);
    return acc;
  }, {});

  const lengths = Object.keys(byLength)
    .map(Number)
    .sort((a, b) => b - a);

  return (
    <div className="word-results">
      <div className="word-results-header">
        <h2>
          {filtered.length} word{filtered.length === 1 ? "" : "s"}
        </h2>
        <input
          type="search"
          placeholder="Filter words…"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          className="filter-input"
        />
      </div>
      <div
        className={`word-list${loading ? " word-list--loading" : ""}`}
        role="list"
        aria-busy={loading}
      >
        {loading ? (
          <WordListLoader />
        ) : (
          <>
            {lengths.map((len) => (
              <section key={len} className="length-group">
                <h3>{len} letters</h3>
                <ul>
                  {byLength[len].map((item) => (
                    <li key={item.word}>
                      <button
                        type="button"
                        className={
                          selectedWord?.word === item.word ? "selected" : undefined
                        }
                        onClick={() =>
                          onSelect(
                            selectedWord?.word === item.word ? null : item
                          )
                        }
                      >
                        {item.word}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {filtered.length === 0 && (
              <p className="empty">No words match your filter.</p>
            )}
          </>
        )}
      </div>
      <WordDefinition
        word={selectedWord?.word ?? null}
        definitionSource={definitionSource}
        onDefinitionSourceChange={onDefinitionSourceChange}
      />
    </div>
  );
}
