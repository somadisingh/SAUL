import type { AnswerStatus, Question } from "../types";

export const statusLabels: Record<AnswerStatus, string> = {
  verified: "Verified",
  employee_confirmed: "User confirmed",
  partially_verified: "Partial",
  conflicted: "Conflicted",
  unknown: "Unknown",
};

export function StatusChip({ status }: { status: AnswerStatus }) {
  return <span className={`status-chip status-${status}`}>{statusLabels[status]}</span>;
}

interface Props {
  questions: Question[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function CaseSidebar({ questions, selectedId, onSelect }: Props) {
  const actions = questions
    .filter((question) => question.followUp)
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  return (
    <aside className="case-sidebar" aria-label="Question navigation">
      {actions.length > 0 && (
        <section className="next-actions">
          <div className="section-kicker">Next actions</div>
          {actions.map((question) => (
            <button className="next-action" key={question.id} onClick={() => onSelect(question.id)}>
              <span>P{question.priority} · {question.id}</span>
              <strong>{question.followUp?.text}</strong>
            </button>
          ))}
        </section>
      )}

      <div className="sidebar-heading">
        <div className="section-kicker">Questionnaire</div>
        <span>{questions.length} questions</span>
      </div>
      {questions.length === 0 ? (
        <div className="sidebar-empty">No questions yet. Import a questionnaire to begin.</div>
      ) : (
        <div className="question-list">
          {questions.map((question) => {
            const openConflicts = question.conflicts.filter((conflict) => conflict.state === "open").length;
            return (
              <button
                className={`question-nav-item ${question.id === selectedId ? "selected" : ""}`}
                key={question.id}
                onClick={() => onSelect(question.id)}
                aria-current={question.id === selectedId ? "true" : undefined}
              >
                <span className="question-nav-top">
                  <strong>{question.id}</strong>
                  <StatusChip status={question.status} />
                </span>
                <span className="question-nav-text">{question.text}</span>
                {openConflicts > 0 && <span className="conflict-flag">● {openConflicts} open conflict{openConflicts === 1 ? "" : "s"}</span>}
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
