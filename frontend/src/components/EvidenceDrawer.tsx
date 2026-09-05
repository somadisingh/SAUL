import { useEffect, useRef } from "react";
import type { Source } from "../types";

interface Props {
  source: Source | null;
  quote: string | null;
  onClose: () => void;
}

export default function EvidenceDrawer({ source, quote, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!source) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [source, onClose]);

  if (!source) return null;

  const index = quote ? source.content.indexOf(quote) : -1;
  const before = index >= 0 ? source.content.slice(0, index) : source.content;
  const exact = index >= 0 && quote ? source.content.slice(index, index + quote.length) : null;
  const after = index >= 0 && quote ? source.content.slice(index + quote.length) : "";

  return (
    <div className="drawer-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
        <header>
          <div>
            <div className="section-kicker">Evidence source</div>
            <h2 id="evidence-title">{source.name}</h2>
          </div>
          <button className="icon-button" ref={closeRef} onClick={onClose} aria-label="Close evidence drawer">×</button>
        </header>
        <dl className="source-meta">
          <div><dt>Type</dt><dd>{source.kind === "employee" ? "Employee statement" : source.kind}</dd></div>
          <div><dt>Scope</dt><dd>{source.scope}</dd></div>
          <div><dt>Observed</dt><dd>{source.observedAt ? new Date(source.observedAt).toLocaleString() : "Date not supplied"}</dd></div>
          {source.author && <div><dt>Author</dt><dd>{source.author}</dd></div>}
        </dl>
        {quote && index < 0 && (
          <div className="inline-warning">The exact stored quote was not found in this source text.</div>
        )}
        <div className="source-content" tabIndex={0}>
          {before}{exact && <mark>{exact}</mark>}{after}
        </div>
      </aside>
    </div>
  );
}
