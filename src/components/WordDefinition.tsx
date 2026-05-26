import { useEffect, useState } from "react";
import {
  formatPartOfSpeech,
  lookupWord,
  type DictionaryEntry,
} from "../lib/dictionaryLookup";

interface WordDefinitionProps {
  word: string | null;
}

type LoadState =
  | { status: "idle" }
  | { status: "loading"; word: string }
  | { status: "ready"; entry: DictionaryEntry }
  | { status: "empty"; word: string }
  | { status: "error"; word: string; message: string };

export function WordDefinition({ word }: WordDefinitionProps) {
  const [state, setState] = useState<LoadState>({ status: "idle" });

  useEffect(() => {
    if (!word) {
      setState({ status: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ status: "loading", word });

    lookupWord(word, controller.signal)
      .then((entry) => {
        if (controller.signal.aborted) return;
        if (entry) {
          setState({ status: "ready", entry });
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
  }, [word]);

  return (
    <aside className="word-definition" aria-live="polite">
      <div className="word-definition__header">
        <h3 className="word-definition__label">Definition</h3>
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
            No dictionary entry found for{" "}
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
            </div>
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
