import { useEffect, useState } from "react";
import {
  DICTIONARY_SOURCE_LABELS,
  formatPartOfSpeech,
  lookupWithFallback,
  otherDictionarySource,
  type DictionaryEntry,
  type DictionarySource,
} from "../lib/dictionaryLookup";

interface WordDefinitionProps {
  word: string | null;
  definitionSource: DictionarySource;
  onDefinitionSourceChange: (source: DictionarySource) => void;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading"; word: string }
  | {
      status: "ready";
      entry: DictionaryEntry;
      usedFallback: boolean;
      primarySource: DictionarySource;
    }
  | { status: "empty"; word: string }
  | { status: "error"; word: string; message: string };

export function WordDefinition({
  word,
  definitionSource,
  onDefinitionSourceChange,
}: WordDefinitionProps) {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  useEffect(() => {
    if (!word) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading", word });

    lookupWithFallback(word, definitionSource, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result) {
          setState({
            status: "ready",
            entry: result.entry,
            usedFallback: result.usedFallback,
            primarySource: definitionSource,
          });
        } else {
          setState({ status: "empty", word });
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Could not load definition.";
        setState({ status: "error", word, message });
      });

    return () => controller.abort();
  }, [word, definitionSource]);

  const fallbackLabel =
    DICTIONARY_SOURCE_LABELS[otherDictionarySource(definitionSource)];

  return (
    <aside className="word-definition" aria-live="polite">
      <div className="word-definition__header">
        <h3 className="word-definition__label">Definition</h3>
        <label className="word-definition__source-field">
          <span className="visually-hidden">Definition source</span>
          <select
            className="word-definition__source-select"
            value={definitionSource}
            onChange={(e) =>
              onDefinitionSourceChange(e.target.value as DictionarySource)
            }
          >
            {(Object.keys(DICTIONARY_SOURCE_LABELS) as DictionarySource[]).map(
              (source) => (
                <option key={source} value={source}>
                  {DICTIONARY_SOURCE_LABELS[source]}
                </option>
              )
            )}
          </select>
        </label>
      </div>

      <div className="word-definition__body">
        {state.status === "idle" && (
          <p className="word-definition__placeholder">
            Select a word from the list to see its meaning and part of speech.
          </p>
        )}

        {state.status === "loading" && (
          <div className="word-definition__loading" aria-busy="true">
            <span className="word-definition__spinner" aria-hidden />
            <span>Looking up “{state.word}”…</span>
          </div>
        )}

        {state.status === "empty" && (
          <p className="word-definition__placeholder">
            No entry in{" "}
            {DICTIONARY_SOURCE_LABELS[definitionSource]} or {fallbackLabel} for{" "}
            <strong className="word-definition__word-inline">{state.word}</strong>
            . It may be obscure, regional, or a game-only form.
          </p>
        )}

        {state.status === "error" && (
          <p className="word-definition__error">{state.message}</p>
        )}

        {state.status === "ready" && (
          <>
            <div className="word-definition__title-row">
              <span className="word-definition__word">{state.entry.word}</span>
              {state.entry.phonetic && (
                <span className="word-definition__phonetic">
                  {state.entry.phonetic}
                </span>
              )}
              <span className="word-definition__source-badge">
                {state.entry.sourceLabel}
                {state.usedFallback && (
                  <span className="word-definition__source-fallback">
                    {" "}
                    · fallback
                  </span>
                )}
              </span>
            </div>
            {state.usedFallback && (
              <p className="word-definition__fallback-note">
                Not found in{" "}
                {DICTIONARY_SOURCE_LABELS[state.primarySource]} — showing{" "}
                {state.entry.sourceLabel} instead.
              </p>
            )}
            <div className="word-definition__senses">
              {state.entry.senses.map((sense) => (
                <section
                  key={`${sense.partOfSpeech}-${sense.definitions[0]?.text.slice(0, 24)}`}
                  className="word-definition__sense"
                >
                  <span className="word-definition__pos">
                    {formatPartOfSpeech(sense.partOfSpeech)}
                  </span>
                  <ol className="word-definition__defs">
                    {sense.definitions.map((def, i) => (
                      <li key={i}>
                        <span className="word-definition__def-text">
                          {def.text}
                        </span>
                        {def.example && (
                          <q className="word-definition__example">
                            {def.example}
                          </q>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
