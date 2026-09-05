import { useState } from "react";
import type { AuditEvent, Health, IntegrationReceipt } from "../types";

interface Props {
  receipts: { prism: IntegrationReceipt; regodit: IntegrationReceipt };
  events: AuditEvent[];
  health: Health | null;
  disabled: boolean;
  onRegoditApi: () => Promise<void>;
  onRegoditManual: (reference: string, url: string | null) => Promise<void>;
  onDownloadJson: () => Promise<void>;
}

const integrationLabels = {
  not_configured: "Setup required",
  ready: "Ready — not sent",
  sent: "Sent",
  manual_required: "Manual action required",
  manual_recorded: "Manual submission recorded",
  error: "Delivery error",
};

function safeHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function ReceiptCard({ receipt, fallbackUrl }: { receipt: IntegrationReceipt; fallbackUrl?: string }) {
  const verifiedUrl = safeHttpUrl(receipt.url);
  return (
    <section className="integration-card">
      <div className="integration-card-top">
        <div><div className="section-kicker">{receipt.provider}</div><h2>{receipt.provider === "prism" ? "PRISM observability" : "Regodit evidence"}</h2></div>
        <span className={`integration-state integration-${receipt.state}`}>{integrationLabels[receipt.state]}</span>
      </div>
      <p>{receipt.message}</p>
      <dl className="receipt-meta">
        <div><dt>Reference</dt><dd>{receipt.reference ?? "Not supplied"}</dd></div>
        <div><dt>Last attempt</dt><dd>{receipt.lastAttemptAt ? new Date(receipt.lastAttemptAt).toLocaleString() : "No attempt recorded"}</dd></div>
        <div><dt>Last success</dt><dd>{receipt.lastSuccessAt ? new Date(receipt.lastSuccessAt).toLocaleString() : "No success recorded"}</dd></div>
      </dl>
      {verifiedUrl ? (
        <a className="secondary-button inline-link" href={verifiedUrl} target="_blank" rel="noopener noreferrer">Open verified link ↗</a>
      ) : fallbackUrl ? (
        <a className="secondary-button inline-link" href={fallbackUrl} target="_blank" rel="noopener noreferrer">Open PRISM dashboard ↗</a>
      ) : null}
    </section>
  );
}

export default function IntegrationsPanel({ receipts, events, health, disabled, onRegoditApi, onRegoditManual, onDownloadJson }: Props) {
  const [reference, setReference] = useState("");
  const [url, setUrl] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submitManual = async () => {
    setLocalError(null);
    const trimmedUrl = url.trim();
    if (trimmedUrl && !safeHttpUrl(trimmedUrl)) {
      setLocalError("The optional link must start with http:// or https://.");
      return;
    }
    await onRegoditManual(reference.trim(), trimmedUrl || null);
  };

  return (
    <section className="integrations-view">
      <header className="view-heading paper-panel">
        <div><div className="section-kicker">Sponsor connections</div><h1>Receipts, not assumptions.</h1></div>
        <p>Configuration means access is available. Only a stored receipt shows an actual delivery.</p>
      </header>
      <div className="integration-grid">
        <ReceiptCard receipt={receipts.prism} fallbackUrl="https://prism.blockconvey.com" />
        <ReceiptCard receipt={receipts.regodit} />
      </div>

      <section className="integration-actions paper-panel">
        <div>
          <div className="section-kicker">Regodit workflow</div>
          <h2>{health?.regoditMode === "api" ? "Submit through configured API" : health?.regoditMode === "manual" ? "Record a real manual submission" : "Regodit setup required"}</h2>
        </div>
        {health?.regoditMode === "api" && (
          <button className="primary-button" disabled={disabled} onClick={() => void onRegoditApi()}>{disabled ? "Submitting…" : "Submit case to Regodit"}</button>
        )}
        {health?.regoditMode === "manual" && (
          <div className="manual-workflow">
            <p>Download the JSON packet, submit it inside Regodit, then record the genuine reference below.</p>
            <button className="secondary-button" disabled={disabled} onClick={() => void onDownloadJson()}>Download JSON packet</button>
            <label>Submission reference<input value={reference} disabled={disabled} onChange={(event) => setReference(event.target.value)} placeholder="Actual Regodit reference" /></label>
            <label>Submission URL (optional)<input value={url} disabled={disabled} onChange={(event) => setUrl(event.target.value)} placeholder="https://…" /></label>
            <label className="check-label"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={(event) => setConfirmed(event.target.checked)} /> I have submitted this case inside Regodit.</label>
            <button className="primary-button" disabled={disabled || !reference.trim() || !confirmed} onClick={() => void submitManual()}>Record manual submission</button>
            {localError && <div className="dialog-error" role="alert">{localError}</div>}
          </div>
        )}
        {(!health || health.regoditMode === "unconfigured") && (
          <div className="setup-required">No supported Regodit access is configured. JSON export remains available for recovery, but export alone is not a submission.</div>
        )}
      </section>

      <section className="audit-history paper-panel">
        <div className="section-title-row"><h2>Audit history</h2><span>Recorded case events</span></div>
        <p className="muted-copy">A readable activity history; it is not presented as tamper-proof.</p>
        {events.length === 0 ? <p className="muted-copy">No events recorded yet.</p> : (
          <ol>
            {[...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((event) => (
              <li key={event.id}>
                <time>{new Date(event.createdAt).toLocaleString()}</time>
                <div><strong>{event.kind.replace(/_/g, " ")}</strong>{event.questionId && <span> · {event.questionId}</span>}<p>{event.summary}</p></div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}
