import { useMemo, useState } from "react";
import VoiceControls from "./VoiceControls";
import type { Message, MessageInput, Question } from "../types";

export interface SendResult {
  outcome: "completed" | "saved" | "error";
  message: string;
}

interface Props {
  caseId: string;
  question: Question | null;
  messages: Message[];
  disabled: boolean;
  onSend: (input: MessageInput) => Promise<SendResult>;
}

function readIdentity() {
  try {
    const stored = localStorage.getItem("bcsDemoEmployee");
    if (stored) return JSON.parse(stored) as { name: string; role: string };
  } catch {
    // Defaults remain intentionally editable demo attribution.
  }
  return { name: "Alex", role: "Engineering" };
}

export default function InterviewPanel({ caseId, question, messages, disabled, onSend }: Props) {
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [identity, setIdentity] = useState(readIdentity);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingIds, setPendingIds] = useState<Record<string, string>>({});
  const [correctionModes, setCorrectionModes] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.questionId === question?.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages, question?.id],
  );

  if (!question) {
    return <aside className="interview-panel"><div className="interview-empty">Select a question to open its employee interview.</div></aside>;
  }

  const questionId = question.id;
  const draft = drafts[questionId] ?? "";
  const correctionMode = correctionModes[questionId] ?? false;
  const followUpAlreadyShown = question.followUp
    ? visibleMessages.some((message) => message.role === "assistant" && (message.id === question.followUp?.id || message.text.trim() === question.followUp?.text.trim()))
    : false;

  const saveIdentity = (next: { name: string; role: string }) => {
    setIdentity(next);
    localStorage.setItem("bcsDemoEmployee", JSON.stringify(next));
  };

  const submit = async () => {
    const text = draft.trim();
    const employeeName = identity.name.trim();
    const employeeRole = identity.role.trim();
    if (!text || !employeeName || !employeeRole) return;

    const clientMessageId = pendingIds[questionId] ?? crypto.randomUUID();
    setPendingIds((current) => ({ ...current, [questionId]: clientMessageId }));
    setNotice(null);
    const result = await onSend({
      questionId,
      text,
      employeeName,
      employeeRole,
      replyToFollowUpId: correctionMode ? null : question.followUp?.id ?? null,
      clientMessageId,
    });
    setNotice(result.message);
    if (result.outcome !== "error") {
      setDrafts((current) => ({ ...current, [questionId]: "" }));
      setPendingIds((current) => {
        const next = { ...current };
        delete next[questionId];
        return next;
      });
      setCorrectionModes((current) => ({ ...current, [questionId]: false }));
    }
  };

  const canReply = Boolean(question.followUp) && !correctionMode;

  return (
    <aside className="interview-panel" aria-label="Employee interview">
      <header className="interview-header">
        <div>
          <div className="section-kicker">Employee interview</div>
          <h2>{question.id} follow-up</h2>
        </div>
        <span className="live-dot">Shared profile</span>
      </header>

      <div className="identity-fields">
        <label>Name<input value={identity.name} disabled={disabled} required onChange={(event) => saveIdentity({ ...identity, name: event.target.value })} /></label>
        <label>Role<input value={identity.role} disabled={disabled} required onChange={(event) => saveIdentity({ ...identity, role: event.target.value })} /></label>
        <p>Self-reported demo attribution only; this is not an authenticated identity.</p>
      </div>

      <div className="message-list" aria-live="polite">
        {visibleMessages.length === 0 && !question.followUp && (
          <div className="interview-empty">No interview is needed right now. You can still record an explicit correction.</div>
        )}
        {visibleMessages.map((message) => (
          <div className={`message message-${message.role}`} key={message.id}>
            <div className="message-byline">
              <strong>{message.role === "assistant" ? "Saul" : message.employeeName ?? "Employee"}</strong>
              <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
            <p>{message.text}</p>
            {message.role === "user" && message.employeeRole && <small>{message.employeeRole}</small>}
          </div>
        ))}
        {question.followUp && !followUpAlreadyShown && (
          <div className="message message-assistant current-followup">
            <div className="message-byline"><strong>Saul</strong><span>Current question</span></div>
            <p>{question.followUp.text}</p>
            <small>{question.followUp.reason}</small>
          </div>
        )}
        {question.followUp && followUpAlreadyShown && (
          <div className="followup-reason"><strong>Why Saul is asking:</strong> {question.followUp.reason}</div>
        )}
      </div>

      <div className="composer">
        <div className="composer-mode">
          {question.followUp && (
            <button className={!correctionMode ? "active" : ""} onClick={() => setCorrectionModes((current) => ({ ...current, [questionId]: false }))}>Reply</button>
          )}
          <button className={correctionMode ? "active" : ""} onClick={() => setCorrectionModes((current) => ({ ...current, [questionId]: true }))}>Correction</button>
        </div>
        {correctionMode && <p className="correction-help">Enter a complete correction with the accurate value and scope.</p>}
        <VoiceControls key={`${caseId}:${questionId}:${question.followUp?.id ?? "none"}`} caseId={caseId} questionId={questionId} disabled={disabled} onBusy={setVoiceBusy} onTranscript={(text) => {
          setDrafts(current => ({ ...current, [questionId]: [current[questionId], text].filter(Boolean).join(" ") }));
          if (!question.followUp) setCorrectionModes(current => ({ ...current, [questionId]: true }));
        }} />
        <label className="sr-only" htmlFor={`reply-${questionId}`}>{correctionMode ? "Correction" : "Employee response"}</label>
        <textarea
          id={`reply-${questionId}`}
          value={draft}
          disabled={disabled}
          placeholder={correctionMode ? "Complete correction…" : question.followUp ? "Answer this one fact…" : "Select Correction to add testimony"}
          onChange={(event) => setDrafts((current) => ({ ...current, [questionId]: event.target.value }))}
        />
        {notice && <div className="composer-notice">{notice}</div>}
        <button
          className="primary-button full-button"
          disabled={disabled || voiceBusy || !draft.trim() || !identity.name.trim() || !identity.role.trim() || (!canReply && !correctionMode)}
          onClick={submit}
        >
          {disabled ? "Saving…" : pendingIds[questionId] ? "Retry safely" : correctionMode ? "Record correction" : "Send response"}
        </button>
      </div>
    </aside>
  );
}
