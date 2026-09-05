export type AnswerStatus = "verified" | "employee_confirmed" | "partially_verified" | "conflicted" | "unknown";
export type Provenance = "company_information" | "user_confirmation" | "needs_confirmation";
export type SourceKind = "policy" | "configuration" | "message" | "report" | "employee";
export type UploadSourceKind = Exclude<SourceKind, "employee">;
export type SlotState = "answered" | "missing" | "deferred";
export type IntegrationState = "not_configured" | "ready" | "sent" | "manual_required" | "manual_recorded" | "error";

export interface Source {
  id: string;
  name: string;
  kind: SourceKind;
  scope: string;
  content: string;
  observedAt: string | null;
  createdAt: string;
  author: string | null;
}

export interface Citation { sourceId: string; quote: string; }

export interface Fact {
  id: string;
  key: string;
  scope: string;
  value: string;
  provenance: Provenance;
  citations: Citation[];
  updatedAt: string;
  supersedesFactId: string | null;
  active: boolean;
}

export interface MissingSlot {
  key: string;
  label: string;
  state: SlotState;
}

export interface Conflict {
  id: string;
  summary: string;
  citations: Citation[];
  state: "open" | "resolved";
  resolution: string | null;
  resolvedAt: string | null;
}

export interface FollowUp {
  id: string;
  slotKey: string;
  text: string;
  reason: string;
  suggestedOwner: string;
}

export interface Question {
  id: string;
  text: string;
  priority: number;
  scope: string;
  answer: string;
  status: AnswerStatus;
  provenance: Provenance;
  citations: Citation[];
  missingSlots: MissingSlot[];
  conflicts: Conflict[];
  followUp: FollowUp | null;
  updatedAt: string;
}

export interface Message {
  id: string;
  clientMessageId: string | null;
  questionId: string;
  role: "assistant" | "user";
  text: string;
  employeeName: string | null;
  employeeRole: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  kind: string;
  questionId: string | null;
  summary: string;
  createdAt: string;
}

export interface IntegrationReceipt {
  provider: "prism" | "regodit";
  state: IntegrationState;
  reference: string | null;
  url: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  message: string;
}

export interface CaseSnapshot {
  id: string;
  companyName: string;
  title: string;
  revision: number;
  needsInvestigation: boolean;
  createdAt: string;
  updatedAt: string;
  sources: Source[];
  questions: Question[];
  facts: Fact[];
  messages: Message[];
  events: AuditEvent[];
  integrations: { prism: IntegrationReceipt; regodit: IntegrationReceipt; };
}

export interface Health {
  status: "ok";
  modelConfigured: boolean;
  prismConfigured: boolean;
  regoditMode: "unconfigured" | "api" | "manual";
}

export interface CaseSummary {
  id: string;
  companyName: string;
  title: string;
  updatedAt: string;
}

export interface MessageInput {
  questionId: string;
  text: string;
  employeeName: string;
  employeeRole: string;
  replyToFollowUpId: string | null;
  clientMessageId: string;
}
