import { useEffect, useRef, useState } from "react";
import type { UploadSourceKind } from "../types";

interface Props {
  open: boolean;
  disabled: boolean;
  canImportQuestionnaire: boolean;
  sourceCount: number;
  sourceCharacters: number;
  onClose: () => void;
  onSource: (body: { name: string; kind: UploadSourceKind; scope: string; content: string; observedAt: string | null }) => Promise<boolean>;
  onQuestionnaire: (body: { format: "csv" | "json"; content: string }) => Promise<boolean>;
}

const allowedExtensions = [".txt", ".md", ".json", ".csv"];

function validateQuestionnaire(content: string, format: "csv" | "json") {
  if (format === "json") {
    const value: unknown = JSON.parse(content);
    if (!Array.isArray(value)) throw new Error("Questionnaire JSON must be an array of objects with id and question fields.");
    const ids = new Set<string>();
    value.forEach((row) => {
      if (!row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string" || typeof (row as { question?: unknown }).question !== "string") {
        throw new Error("Every questionnaire item must have string id and question fields.");
      }
      const id = (row as { id: string }).id.trim();
      const question = (row as { question: string }).question.trim();
      if (!id || !question) throw new Error("Question IDs and question text cannot be blank.");
      if (ids.has(id)) throw new Error(`Question ID ${id} is duplicated.`);
      ids.add(id);
    });
    return value.length;
  }
  const rows: string[][] = [[]];
  let field = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      rows[rows.length - 1].push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      rows[rows.length - 1].push(field);
      field = "";
      rows.push([]);
    } else {
      field += character;
    }
  }
  rows[rows.length - 1].push(field);
  const populated = rows.filter((row) => row.some((value) => value.trim()));
  if (populated.length === 0) return 0;
  const headers = populated[0].map((value) => value.trim().toLowerCase());
  const idIndex = headers.indexOf("id");
  const questionIndex = headers.indexOf("question");
  if (idIndex < 0 || questionIndex < 0) throw new Error("Questionnaire CSV must contain id and question columns.");
  const ids = new Set<string>();
  populated.slice(1).forEach((row) => {
    const id = row[idIndex]?.trim() ?? "";
    const question = row[questionIndex]?.trim() ?? "";
    if (!id || !question) throw new Error("Question IDs and question text cannot be blank.");
    if (ids.has(id)) throw new Error(`Question ID ${id} is duplicated.`);
    ids.add(id);
  });
  return populated.length - 1;
}

export default function UploadDialog({ open, disabled, canImportQuestionnaire, sourceCount, sourceCharacters, onClose, onSource, onQuestionnaire }: Props) {
  const [tab, setTab] = useState<"source" | "questionnaire">("source");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<UploadSourceKind | "">("");
  const [scope, setScope] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [questionnaireContent, setQuestionnaireContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !disabled && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, disabled, onClose]);

  if (!open) return null;

  const readFile = async (file: File, target: "source" | "questionnaire") => {
    setError(null);
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      setError("Supported text formats are .txt, .md, .json, and .csv. PDF, DOCX, and XLSX are not supported.");
      return;
    }
    const text = await file.text();
    if (text.includes("\uFFFD")) {
      setError("The file must be valid UTF-8 text.");
      return;
    }
    if (target === "source") {
      setName((current) => current || file.name);
      setSourceContent(text);
    } else {
      if (extension !== ".csv" && extension !== ".json") {
        setError("Questionnaires must be .csv or .json.");
        return;
      }
      setFormat(extension === ".json" ? "json" : "csv");
      setQuestionnaireContent(text);
    }
  };

  const submitSource = async () => {
    setError(null);
    const normalized = sourceContent.replace(/\r\n/g, "\n");
    if (!name.trim() || !kind || !scope.trim() || !normalized.trim()) {
      setError("Name, evidence type, scope, and text are required.");
      return;
    }
    if (normalized.length > 30_000) {
      setError("A source can contain at most 30,000 characters.");
      return;
    }
    if (sourceCount >= 20 || sourceCharacters + normalized.length > 100_000) {
      setError("This case is limited to 20 sources and 100,000 source characters.");
      return;
    }
    let isoDate: string | null = null;
    if (observedAt.trim()) {
      const date = new Date(observedAt);
      if (Number.isNaN(date.valueOf())) {
        setError("Observation time must be a valid ISO-8601 date/time, or left blank when unknown.");
        return;
      }
      isoDate = date.toISOString();
    }
    if (await onSource({ name: name.trim(), kind, scope: scope.trim(), content: normalized, observedAt: isoDate })) onClose();
  };

  const submitQuestionnaire = async () => {
    setError(null);
    try {
      const count = validateQuestionnaire(questionnaireContent, format);
      if (count < 1) throw new Error("The questionnaire is empty.");
      if (count > 12) throw new Error("Questionnaires can contain at most 12 questions.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The questionnaire could not be read.");
      return;
    }
    if (await onQuestionnaire({ format, content: questionnaireContent })) onClose();
  };

  return (
    <div className="modal-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !disabled && onClose()}>
      <section className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <header>
          <div><div className="section-kicker">Bring in evidence</div><h2 id="upload-title">Upload or paste text</h2></div>
          <button className="icon-button" ref={closeRef} onClick={onClose} disabled={disabled} aria-label="Close upload dialog">×</button>
        </header>
        <div className="dialog-tabs">
          <button className={tab === "source" ? "active" : ""} onClick={() => setTab("source")}>Evidence source</button>
          <button className={tab === "questionnaire" ? "active" : ""} onClick={() => setTab("questionnaire")}>Questionnaire</button>
        </div>
        {tab === "source" ? (
          <div className="dialog-body form-grid">
            <label className="wide">Text file<input type="file" accept=".txt,.md,.json,.csv,text/plain,text/markdown,text/csv,application/json" disabled={disabled} onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0], "source")} /></label>
            <p className="format-note wide">UTF-8 .txt, .md, .json, or .csv only. Up to 30,000 characters. JSON is treated as evidence text, never executed.</p>
            <label>Source name<input value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} /></label>
            <label>Evidence type<select value={kind} disabled={disabled} onChange={(event) => setKind(event.target.value as UploadSourceKind | "")}><option value="">Choose a meaningful type…</option><option value="policy">Policy</option><option value="configuration">Configuration</option><option value="message">Message</option><option value="report">Report</option></select></label>
            <label className="wide">Scope<input value={scope} disabled={disabled} placeholder="e.g. AWS production human access" onChange={(event) => setScope(event.target.value)} /></label>
            <label className="wide">Observed at (optional)<input value={observedAt} disabled={disabled} placeholder="2026-09-05T13:00:00Z — leave blank if unknown" onChange={(event) => setObservedAt(event.target.value)} /></label>
            <label className="wide">Paste or edit source text<textarea rows={9} value={sourceContent} disabled={disabled} onChange={(event) => setSourceContent(event.target.value)} /></label>
            <div className="character-count wide">{sourceContent.replace(/\r\n/g, "\n").length.toLocaleString()} / 30,000 characters</div>
            <button className="primary-button wide" disabled={disabled} onClick={submitSource}>{disabled ? "Uploading…" : "Add evidence source"}</button>
          </div>
        ) : (
          <div className="dialog-body form-grid">
            {!canImportQuestionnaire && <div className="inline-warning wide">This case already has questions. Replacement is disabled; create a new blank case to import another questionnaire.</div>}
            <label>Format<select value={format} disabled={disabled || !canImportQuestionnaire} onChange={(event) => setFormat(event.target.value as "csv" | "json")}><option value="csv">CSV</option><option value="json">JSON</option></select></label>
            <label>Questionnaire file<input type="file" accept=".csv,.json,text/csv,application/json" disabled={disabled || !canImportQuestionnaire} onChange={(event) => event.target.files?.[0] && void readFile(event.target.files[0], "questionnaire")} /></label>
            <p className="format-note wide">CSV columns: id,question. JSON: an array of objects with id and question. Maximum 12 questions.</p>
            <label className="wide">Original content<textarea rows={10} value={questionnaireContent} disabled={disabled || !canImportQuestionnaire} onChange={(event) => setQuestionnaireContent(event.target.value)} /></label>
            <button className="primary-button wide" disabled={disabled || !canImportQuestionnaire || !questionnaireContent.trim()} onClick={submitQuestionnaire}>{disabled ? "Importing…" : "Import questionnaire"}</button>
          </div>
        )}
        {error && <div className="dialog-error" role="alert">{error}</div>}
      </section>
    </div>
  );
}
