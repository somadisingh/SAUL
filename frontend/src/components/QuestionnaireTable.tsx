import type { Question } from "../types";
import { StatusChip } from "./CaseSidebar";

interface Props {
  questions: Question[];
  onOpen: (questionId: string) => void;
}

export default function QuestionnaireTable({ questions, onOpen }: Props) {
  return (
    <section className="table-view paper-panel">
      <header className="view-heading">
        <div>
          <div className="section-kicker">Complete questionnaire</div>
          <h1>Every answer, including the unknowns.</h1>
        </div>
        <span>{questions.length} rows</span>
      </header>
      {questions.length === 0 ? (
        <div className="empty-table">This case has no questionnaire yet. Use Upload / import to add one.</div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Question</th>
                <th>Answer</th>
                <th>Status</th>
                <th>Evidence</th>
                <th>Remaining action</th>
              </tr>
            </thead>
            <tbody>
              {questions.map((question) => (
                <tr key={question.id} onClick={() => onOpen(question.id)}>
                  <td><button className="table-question" onClick={() => onOpen(question.id)}><strong>{question.id}</strong>{question.text}</button></td>
                  <td>{question.answer || "No supported answer yet."}</td>
                  <td>
                    <StatusChip status={question.status} />
                    <small>{question.provenance === "company_information" ? "Verified from company information" : question.provenance === "user_confirmation" ? "Confirmed by user" : "Unknown / needs confirmation"}</small>
                  </td>
                  <td>{question.citations.length}</td>
                  <td>{question.followUp?.text ?? (question.missingSlots.some((slot) => slot.state !== "answered") ? "Review missing facts" : "None")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
