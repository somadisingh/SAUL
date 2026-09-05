import type {
  CaseSnapshot,
  CaseSummary,
  Health,
  IntegrationReceipt,
  MessageInput,
  UploadSourceKind,
} from "./types";

const configuredBase = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE = configuredBase ? configuredBase.replace(/\/$/, "") : "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  let code = "REQUEST_FAILED";
  try {
    const body = await response.json() as { error?: { code?: string; message?: string }; detail?: unknown };
    if (body.error?.message) message = body.error.message;
    if (body.error?.code) code = body.error.code;
    if (!body.error && typeof body.detail === "string") message = body.detail;
  } catch {
    // The safe status-based message above remains available for non-JSON failures.
  }
  return new ApiError(message, response.status, code);
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: controller.signal,
    });
    if (!response.ok) throw await parseError(response);
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new ApiError("The API returned an unexpected response instead of JSON.", response.status, "UNEXPECTED_RESPONSE");
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("The request timed out. The server may still have saved your change.", 0, "TIMEOUT");
    }
    if (error instanceof ApiError) throw error;
    throw new ApiError("Could not reach the BetterCallSaul API. Check that the backend is running on port 8000.", 0, "NETWORK_ERROR");
  } finally {
    window.clearTimeout(timer);
  }
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export const api = {
  voiceStatus: () => request<{ configured: boolean }>("/voice/status"),
  voice: async (path: string, signal: AbortSignal, audio?: Blob): Promise<Response> => {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST", signal,
      headers: audio ? { "Content-Type": audio.type } : {}, body: audio,
    });
    if (!response.ok) throw await parseError(response);
    return response;
  },
  health: () => request<Health>("/health"),
  listCases: () => request<{ cases: CaseSummary[] }>("/cases"),
  createCase: (seedDemo: boolean) => request<CaseSnapshot>("/cases", json("POST", { companyName: "AcmePay", seedDemo })),
  getCase: (caseId: string) => request<CaseSnapshot>(`/cases/${encodeURIComponent(caseId)}`),
  investigate: (caseId: string) => request<CaseSnapshot>(`/cases/${encodeURIComponent(caseId)}/investigate`, json("POST", {}), 75_000),
  addSource: (caseId: string, body: { name: string; kind: UploadSourceKind; scope: string; content: string; observedAt: string | null }) =>
    request<CaseSnapshot>(`/cases/${encodeURIComponent(caseId)}/sources`, json("POST", body)),
  importQuestionnaire: (caseId: string, body: { format: "csv" | "json"; content: string }) =>
    request<CaseSnapshot>(`/cases/${encodeURIComponent(caseId)}/questionnaire`, json("POST", body)),
  sendMessage: (caseId: string, body: MessageInput) =>
    request<CaseSnapshot>(`/cases/${encodeURIComponent(caseId)}/messages`, json("POST", body), 75_000),
  submitRegodit: (caseId: string, body: { mode: "api" } | { mode: "manual"; reference: string; url: string | null }) =>
    request<IntegrationReceipt>(`/cases/${encodeURIComponent(caseId)}/integrations/regodit`, json("POST", body), 75_000),
  downloadExport: async (caseId: string, format: "csv" | "json") => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(`${API_BASE}/cases/${encodeURIComponent(caseId)}/export?format=${format}`, { signal: controller.signal });
      if (!response.ok) throw await parseError(response);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${caseId}-case-export.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ApiError("The export timed out. Try again.", 0, "TIMEOUT");
      }
      if (error instanceof ApiError) throw error;
      throw new ApiError("The export could not be downloaded.", 0, "NETWORK_ERROR");
    } finally {
      window.clearTimeout(timer);
    }
  },
};
