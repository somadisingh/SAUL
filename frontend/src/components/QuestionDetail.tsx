import type { Citation, Question, Source } from "../types";
import { StatusChip } from "./CaseSidebar";

const provenanceLabels = {
  company_information: "Verified from company information",
  user_confirmation: "Confirmed by user",
  needs_confirmation: "Unknown / needs confirmation",
};

interface Props {
  question: Question | null;
  sources: Source[];
  pendingReview: boolean;
  onOpenCitation: (citation: Citation) => void;
}

export default function QuestionDetail({ question, sources, pendingReview, onOpenCitation }: Props) {
  if (!question) {
    return (
      <section className="empty-detail paper-panel">
        <span className="empty-monogram">?</span>
        <h2>No question selected</h2>
        <p>Import a questionnaire or select a question to inspect its answer and evidence.</p>
      </section>
    );
  }

  const sourceName = (id: string) => sources.find((source) => source.id === id)?.name ?? "Source unavailable";

  return (
    <article className={`question-detail paper-panel ${pendingReview ? "pending-review" : ""}`}>
      <header className="detail-header">
        <div>
          <div className="section-kicker">{question.id} · Priority {question.priority} · {question.scope}</div>
          <h1>{question.text}</h1>
        </div>
        <StatusChip status={question.status} />
      </header>

      {pendingReview && (
        <div className="inline-warning">This answer predates newer evidence and is pending review.</div>
      )}

      <section className="answer-block">
        <div className="section-kicker">Scoped answer</div>
        <p className={question.status === "unknown" ? "unknown-answer" : ""}>
          {question.answer || "No supported answer yet."}
        </p>
        <div className="provenance-line">Provenance: <strong>{provenanceLabels[question.provenance]}</strong></div>
      </section>

      <section>
        <div className="section-title-row">
          <h2>Evidence</h2>
          <span>{question.citations.length} citation{question.citations.length === 1 ? "" : "s"}</span>
        </div>
        {question.citations.length === 0 ? (
          <p className="muted-copy">No supporting evidence is attached to this answer.</p>
        ) : (
          <div className="citation-list">
            {question.citations.map((citation, index) => (
              <button className="citation-card" key={`${citation.sourceId}-${index}`} onClick={() => onOpenCitation(citation)}>
                <span className="citation-index">{String(index + 1).padStart(2, "0")}</span>
                <span>
                  <strong>{sourceName(citation.sourceId)}</strong>
                  <q>{citation.quote}</q>
                </span>
                <span aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Remaining facts</h2>
        {question.missingSlots.length === 0 ? (
          <p className="muted-copy">No missing facts recorded.</p>
        ) : (
          <ul className="slot-list">
            {question.missingSlots.map((slot) => (
              <li key={slot.key}>
                <span className={`slot-state slot-${slot.state}`}>{slot.state}</span>
                <span>{slot.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {question.conflicts.length > 0 && (
        <section>
          <h2>Conflicts</h2>
          <div className="conflict-list">
            {question.conflicts.map((conflict) => (
              <div className={`conflict-card conflict-${conflict.state}`} key={conflict.id}>
                <div className="conflict-heading">
                  <strong>{conflict.state === "open" ? "Open conflict" : "Resolved conflict"}</strong>
                  {conflict.resolvedAt && <span>{new Date(conflict.resolvedAt).toLocaleString()}</span>}
                </div>
                <p>{conflict.summary}</p>
                {conflict.resolution && <p className="resolution"><strong>Resolution:</strong> {conflict.resolution}</p>}
                <div className="conflict-citations">
                  {conflict.citations.map((citation, index) => (
                    <button key={`${citation.sourceId}-${index}`} onClick={() => onOpenCitation(citation)}>
                      {sourceName(citation.sourceId)}: “{citation.quote}”
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
