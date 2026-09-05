import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api } from "./api";
import type { CaseSnapshot, CaseSummary, Citation, Health, MessageInput, Source } from "./types";
import CaseSidebar from "./components/CaseSidebar";
import EvidenceDrawer from "./components/EvidenceDrawer";
import IntegrationsPanel from "./components/IntegrationsPanel";
import InterviewPanel, { type SendResult } from "./components/InterviewPanel";
import QuestionDetail from "./components/QuestionDetail";
import QuestionnaireTable from "./components/QuestionnaireTable";
import UploadDialog from "./components/UploadDialog";

type View = "investigation" | "questionnaire" | "integrations";
type MobilePanel = "questions" | "answer" | "interview";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [caseSnapshot, setCaseSnapshot] = useState<CaseSnapshot | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [view, setView] = useState<View>("investigation");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("answer");
  const [loading, setLoading] = useState(true);
  const [mutation, setMutation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedLoadFailed, setSavedLoadFailed] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openEvidence, setOpenEvidence] = useState<{ source: Source; quote: string } | null>(null);

  const applySnapshot = useCallback((snapshot: CaseSnapshot) => {
    setCaseSnapshot(snapshot);
    localStorage.setItem("betterCallSaulActiveCaseId", snapshot.id);
    setSavedLoadFailed(false);
    setSelectedQuestionId((current) => {
      if (current && snapshot.questions.some((question) => question.id === current)) return current;
      return snapshot.questions.find((question) => question.id === "Q1")?.id ?? snapshot.questions[0]?.id ?? null;
    });
  }, []);

  const refreshLists = useCallback(async () => {
    const [healthResult, casesResult] = await Promise.allSettled([api.health(), api.listCases()]);
    if (healthResult.status === "fulfilled") setHealth(healthResult.value);
    else setHealth(null);
    if (casesResult.status === "fulfilled") setCases(casesResult.value.cases);
    return { healthResult, casesResult };
  }, []);

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    const savedId = localStorage.getItem("betterCallSaulActiveCaseId");
    await refreshLists();
    if (savedId) {
      try {
        applySnapshot(await api.getCase(savedId));
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 404) {
          localStorage.removeItem("betterCallSaulActiveCaseId");
          setSavedLoadFailed(false);
          setError("The saved case no longer exists. Choose another case or create one.");
        } else {
          setSavedLoadFailed(true);
          setError(errorMessage(caught));
        }
      }
    }
    setLoading(false);
  }, [applySnapshot, refreshLists]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  const selectedQuestion = useMemo(
    () => caseSnapshot?.questions.find((question) => question.id === selectedQuestionId) ?? null,
    [caseSnapshot, selectedQuestionId],
  );

  const counts = useMemo(() => {
    const initial = { verified: 0, employee_confirmed: 0, partially_verified: 0, conflicted: 0, unknown: 0 };
    caseSnapshot?.questions.forEach((question) => { initial[question.status] += 1; });
    return initial;
  }, [caseSnapshot]);

  const selectQuestion = (id: string) => {
    setSelectedQuestionId(id);
    setMobilePanel("answer");
  };

  const loadCase = async (caseId: string) => {
    setLoading(true);
    setError(null);
    try {
      applySnapshot(await api.getCase(caseId));
      setView("investigation");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  const createCase = async (seedDemo: boolean) => {
    setMutation("create");
    setError(null);
    try {
      applySnapshot(await api.createCase(seedDemo));
      setView("investigation");
      const result = await api.listCases();
      setCases(result.cases);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setMutation(null);
    }
  };

  const refreshCase = useCallback(async () => {
    if (!caseSnapshot) return null;
    const snapshot = await api.getCase(caseSnapshot.id);
    applySnapshot(snapshot);
    return snapshot;
  }, [applySnapshot, caseSnapshot]);

  const investigate = async () => {
    if (!caseSnapshot) return;
    if (!health?.modelConfigured) {
      setError("SAUL is unavailable because the model is not configured. Configure LLM_BASE_URL, LLM_API_KEY, and LLM_MODEL on the backend before investigating.");
      return;
    }
    setMutation("investigate");
    setError(null);
    try {
      applySnapshot(await api.investigate(caseSnapshot.id));
    } catch (caught) {
      try { await refreshCase(); } catch { /* Keep the original actionable error. */ }
      setError(errorMessage(caught));
    } finally {
      setMutation(null);
    }
  };

  const sendMessage = async (input: MessageInput): Promise<SendResult> => {
    if (!caseSnapshot) return { outcome: "error", message: "No active case." };
    const caseId = caseSnapshot.id;
    const frozenInput = { ...input };
    setMutation("message");
    setError(null);
    try {
      applySnapshot(await api.sendMessage(caseId, frozenInput));
      return { outcome: "completed", message: "Response saved and the affected evidence was reviewed." };
    } catch (caught) {
      let refreshed: CaseSnapshot | null = null;
      try {
        refreshed = await api.getCase(caseId);
        applySnapshot(refreshed);
      } catch {
        // Reusing the same clientMessageId keeps the retry safe when status is unknown.
      }
      if (refreshed?.messages.some((message) => message.clientMessageId === frozenInput.clientMessageId)) {
        const message = "Your response was saved, but review did not finish. Investigate the case again; do not resend it.";
        setError(message);
        return { outcome: "saved", message };
      }
      const message = caught instanceof ApiError && caught.status === 409
        ? "The follow-up changed while you were replying. The latest case is loaded; review it before resending."
        : `${errorMessage(caught)} Your draft is preserved, and Retry safely will reuse the same message ID.`;
      setError(message);
      return { outcome: "error", message };
    } finally {
      setMutation(null);
    }
  };

  const addSource = async (body: Parameters<typeof api.addSource>[1]) => {
    if (!caseSnapshot) return false;
    setMutation("source");
    setError(null);
    try {
      applySnapshot(await api.addSource(caseSnapshot.id, body));
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setMutation(null);
    }
  };

  const importQuestionnaire = async (body: Parameters<typeof api.importQuestionnaire>[1]) => {
    if (!caseSnapshot) return false;
    setMutation("questionnaire");
    setError(null);
    try {
      applySnapshot(await api.importQuestionnaire(caseSnapshot.id, body));
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setMutation(null);
    }
  };

  const download = async (format: "csv" | "json") => {
    if (!caseSnapshot) return;
    setMutation(`export-${format}`);
    setError(null);
    try {
      await api.downloadExport(caseSnapshot.id, format);
    } catch (caught) {
      setError(format === "csv" && caseSnapshot.needsInvestigation
        ? `CSV is unavailable until the changed evidence is investigated. ${errorMessage(caught)}`
        : errorMessage(caught));
    } finally {
      setMutation(null);
    }
  };

  const submitRegodit = async (body: Parameters<typeof api.submitRegodit>[1]) => {
    if (!caseSnapshot) return;
    setMutation("regodit");
    setError(null);
    try {
      await api.submitRegodit(caseSnapshot.id, body);
      applySnapshot(await api.getCase(caseSnapshot.id));
    } catch (caught) {
      try { applySnapshot(await api.getCase(caseSnapshot.id)); } catch { /* Receipt error remains visible. */ }
      setError(errorMessage(caught));
    } finally {
      setMutation(null);
    }
  };

  const openCitation = (citation: Citation) => {
    const source = caseSnapshot?.sources.find((item) => item.id === citation.sourceId);
    if (!source) {
      setError(`Source ${citation.sourceId} is not present in this case snapshot.`);
      return;
    }
    setOpenEvidence({ source, quote: citation.quote });
  };

  if (loading && !caseSnapshot) {
    return <div className="splash"><div className="brand-mark">BCS</div><h1>Opening the case file…</h1><div className="loading-bar" /></div>;
  }

  if (!caseSnapshot) {
    return (
      <div className="case-selection-shell">
        <header className="selection-topbar">
          <div className="wordmark"><span className="brand-mark small">BCS</span><span><strong>BetterCallSaul</strong><small>Evidence-first security investigations</small></span></div>
          <span className={`connection-state ${health ? "online" : "offline"}`}>{health ? "API connected" : "API unavailable"}</span>
        </header>
        <main className="case-selection">
          <div className="selection-intro"><div className="section-kicker">Case intake</div><h1>The evidence is scattered.<br />Let’s put it on the record.</h1><p>Create a fictional AcmePay demo or continue a case already stored by the backend.</p></div>
          {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
          {savedLoadFailed && <button className="primary-button retry-button" onClick={() => void bootstrap()}>Retry saved case</button>}
          {!health && !savedLoadFailed && <button className="primary-button retry-button" onClick={() => void bootstrap()}>Retry API connection</button>}
          <section className="new-case-card paper-panel">
            <div><div className="section-kicker">Start a case</div><h2>AcmePay security questionnaire</h2><p>All demo data is fictional.</p></div>
            <div className="case-create-actions">
              <button className="primary-button" disabled={Boolean(mutation) || !health} onClick={() => void createCase(true)}>{mutation === "create" ? "Creating…" : "Load AcmePay demo"}</button>
              <button className="secondary-button" disabled={Boolean(mutation) || !health} onClick={() => void createCase(false)}>Create blank case</button>
            </div>
          </section>
          <section className="existing-cases">
            <div className="section-title-row"><h2>Existing cases</h2><button className="text-button" onClick={() => void refreshLists()}>Refresh list</button></div>
            {cases.length === 0 ? <p className="muted-copy">No stored cases are available.</p> : cases.map((item) => (
              <button className="case-row" key={item.id} onClick={() => void loadCase(item.id)}>
                <span><strong>{item.title}</strong><small>{item.companyName} · Updated {new Date(item.updatedAt).toLocaleString()}</small></span><span>Open →</span>
              </button>
            ))}
          </section>
        </main>
      </div>
    );
  }

  const sourceCharacters = caseSnapshot.sources.reduce((total, source) => total + source.content.length, 0);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="wordmark"><span className="brand-mark small">BCS</span><span><strong>BetterCallSaul</strong><small>Investigation workspace</small></span></div>
        <nav className="view-switch" aria-label="Workspace views">
          {(["investigation", "questionnaire", "integrations"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}
        </nav>
        <div className="topbar-actions">
          <span className={`connection-state ${health ? "online" : "offline"}`}>{health ? health.modelConfigured ? "API + model ready" : "API ready · model setup needed" : "API status unavailable"}</span>
          <button className="secondary-button compact" disabled={Boolean(mutation)} onClick={() => setUploadOpen(true)}>Upload / import</button>
          <button className="secondary-button compact" disabled={Boolean(mutation)} onClick={() => void download("json")}>JSON</button>
          <button className="secondary-button compact" disabled={Boolean(mutation) || caseSnapshot.needsInvestigation} title={caseSnapshot.needsInvestigation ? "Investigate changed evidence before CSV export" : undefined} onClick={() => void download("csv")}>CSV</button>
        </div>
      </header>

      <section className="case-bar">
        <div className="case-title"><button className="text-button" onClick={() => setCaseSnapshot(null)}>All cases</button><span>/</span><strong>{caseSnapshot.title}</strong><span className="revision">rev {caseSnapshot.revision}</span></div>
        <div className="case-stats" aria-label="Answer status counts">
          <span><i className="dot verified" />{counts.verified} verified</span>
          <span><i className="dot employee" />{counts.employee_confirmed} user-confirmed</span>
          <span><i className="dot partial" />{counts.partially_verified} partial</span>
          <span><i className="dot conflict" />{counts.conflicted} conflicted</span>
          <span><i className="dot unknown" />{counts.unknown} unknown</span>
        </div>
        <button
          className="primary-button investigate-button"
          disabled={Boolean(mutation) || caseSnapshot.questions.length === 0 || !health?.modelConfigured}
          title={!health?.modelConfigured ? "Configure the backend model before running SAUL" : undefined}
          onClick={() => void investigate()}
        >
          {mutation === "investigate" ? "Saul is reviewing the evidence…" : !health?.modelConfigured ? "Model setup required" : caseSnapshot.needsInvestigation ? "Investigate again" : "Investigate evidence"}
        </button>
      </section>

      {caseSnapshot.needsInvestigation && <div className="review-banner"><strong>Evidence changed — investigate again.</strong><span>Existing answers remain visible but are pending review. CSV export is paused.</span></div>}
      {error && <div className="error-banner app-error" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
      {mutation && mutation !== "investigate" && <div className="mutation-strip" role="status">Saving case change…</div>}

      {view === "investigation" && (
        <>
          <div className="mobile-panel-tabs" aria-label="Investigation panels">
            <button className={mobilePanel === "questions" ? "active" : ""} onClick={() => setMobilePanel("questions")}>Questions</button>
            <button className={mobilePanel === "answer" ? "active" : ""} onClick={() => setMobilePanel("answer")}>Answer</button>
            <button className={mobilePanel === "interview" ? "active" : ""} onClick={() => setMobilePanel("interview")}>Interview</button>
          </div>
          <main className={`workspace-grid mobile-${mobilePanel}`}>
            <CaseSidebar questions={caseSnapshot.questions} selectedId={selectedQuestionId} onSelect={selectQuestion} />
            <div className="question-detail-wrap"><QuestionDetail question={selectedQuestion} sources={caseSnapshot.sources} pendingReview={caseSnapshot.needsInvestigation} onOpenCitation={openCitation} /></div>
            <InterviewPanel key={caseSnapshot.id} caseId={caseSnapshot.id} question={selectedQuestion} messages={caseSnapshot.messages} disabled={Boolean(mutation)} onSend={sendMessage} />
          </main>
        </>
      )}
      {view === "questionnaire" && <main className="single-view"><QuestionnaireTable questions={caseSnapshot.questions} onOpen={(id) => { selectQuestion(id); setView("investigation"); }} /></main>}
      {view === "integrations" && <main className="single-view"><IntegrationsPanel receipts={caseSnapshot.integrations} events={caseSnapshot.events} health={health} disabled={Boolean(mutation)} onRegoditApi={() => submitRegodit({ mode: "api" })} onRegoditManual={(reference, url) => submitRegodit({ mode: "manual", reference, url })} onDownloadJson={() => download("json")} /></main>}

      <EvidenceDrawer source={openEvidence?.source ?? null} quote={openEvidence?.quote ?? null} onClose={() => setOpenEvidence(null)} />
      <UploadDialog open={uploadOpen} disabled={Boolean(mutation)} canImportQuestionnaire={caseSnapshot.questions.length === 0} sourceCount={caseSnapshot.sources.length} sourceCharacters={sourceCharacters} onClose={() => setUploadOpen(false)} onSource={addSource} onQuestionnaire={importQuestionnaire} />
    </div>
  );
}
