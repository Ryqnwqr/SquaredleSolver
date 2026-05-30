const DOT_COUNT = 6;

export function WordListLoader() {
  return (
    <div className="word-list-loader" role="status" aria-label="Loading word list">
      <div className="word-list-loader__orbit" aria-hidden>
        {Array.from({ length: DOT_COUNT }, (_, i) => (
          <span key={i} className="word-list-loader__dot" />
        ))}
      </div>
    </div>
  );
}
