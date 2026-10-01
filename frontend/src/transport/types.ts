/** Data contracts shared by every transport implementation (HTTP today, demo later). */

export interface Persona {
  key: string;
  name: string;
  label: string;
  description: string;
  employee_id: string;
  title: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  icon: string;
  status?: string;
  version?: number;
  builtin?: boolean;
  origin?: string;
  audience?: unknown;
  tools?: string[];
  knowledge?: string[];
}

export interface Branding {
  productName: string;
  tagline: string;
  taglineEn?: string;
  assistantName?: string;
  company: { name: string; shortName: string; cnpj?: string; headquarters?: string; fictional?: boolean };
  demoBanner?: string;
  repositoryUrl?: string;
}

export interface Me {
  employee_id: string;
  name: string;
  email: string;
  title: string;
  unit_id: string;
  roles: string[];
  hire_date: string;
  agents: AgentInfo[];
  starters: string[];
  transparency_notice: string;
  branding: Branding;
}

/** Card payloads are produced by the back-end tools; each card component narrows `data`
 *  to its own declared shape with a single documented cast. */
export interface Card {
  type: string;
  data: unknown;
  agent_id?: string;
}

export interface Citation {
  id: string;
  kb: string;
  document: string;
  section: string;
  snippet: string;
  source?: string;
  url?: string;
}

export interface Decision {
  allowed: boolean;
  policy: string;
  reason: string;
}

export interface GuardrailTrace {
  name: string;
  stage: string;
  outcome: 'pass' | 'warn' | 'mask' | 'block' | string;
  detail?: string;
}

export interface RouteTrace {
  mode: string;
  agents: string[];
  agent_names?: string[];
  reason?: string;
  method?: string;
  life_event?: string | null;
  scores?: Record<string, number>;
  clarification?: string | null;
}

export interface AuthzTrace {
  subject: string | null;
  subject_name: string | null;
  /** person | manager | team | group | company (round 3 subject check) */
  scope?: string;
  action: string;
  decision: Decision;
}

export interface ToolTrace {
  agent_id?: string;
  tool: string;
  title?: string;
  risk: 'read' | 'write' | 'sensitive' | string;
  args: Record<string, unknown>;
  decision: Decision;
  status: string;
  duration_ms: number;
  error?: string | null;
}

export interface Usage {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
}

export interface Proposal {
  id: string;
  token?: string;
  tool: string;
  title?: string;
  agent_id?: string;
  summary: string;
  details: { label: string; value: string }[];
  risk: string;
  step_up_required: boolean;
  expires_at: string;
  status?: string;
}

export interface ProposalResult {
  id: string;
  status: string;
  summary?: string;
  data?: Record<string, unknown>;
  card?: Card | null;
}

export type StreamEvent =
  | { event: 'message.start'; data: { conversation_id: string; request_id?: string; message_id?: string } }
  | { event: 'trace.guardrail'; data: GuardrailTrace }
  | { event: 'trace.route'; data: RouteTrace }
  | { event: 'trace.authz'; data: AuthzTrace }
  | { event: 'agent.start'; data: { agent_id: string; agent_name: string } }
  | { event: 'trace.tool'; data: ToolTrace }
  | { event: 'card'; data: { agent_id: string; card: Card } }
  | { event: 'citation'; data: Citation }
  | { event: 'proposal'; data: Proposal }
  | { event: 'text.delta'; data: { delta: string } }
  | { event: 'suggestions'; data: { items: string[] } }
  | { event: 'usage'; data: Usage }
  | { event: 'message.end'; data: { message_id: string; resolved: boolean } }
  | { event: 'error'; data: { code: string; message: string } };

export interface MessageTrace {
  guardrails: GuardrailTrace[];
  route: RouteTrace | null;
  authz?: AuthzTrace | null;
  tools: ToolTrace[];
  agents: string[];
}

export interface StoredPayload {
  trace?: MessageTrace;
  cards?: Card[];
  citations?: Citation[];
  proposals?: Proposal[];
  usage?: Usage;
  agents?: string[];
  suggestions?: string[];
  attachments?: { upload_id: string; filename: string }[];
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | string;
  content: string;
  redacted: boolean;
  payload: StoredPayload | null;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  playground_agent: string | null;
  sensitive: boolean;
  created_at: string;
  updated_at: string;
}

export interface UploadResult {
  upload_id: string;
  filename: string;
  size: number;
  readable: boolean;
}

export interface ChatRequest {
  message: string;
  conversation_id?: string;
  attachments?: string[];
  playground_agent?: string;
}

// --------------------------------------------------------------------- governance console
export interface ConsoleOverview {
  window_days: number;
  totals: {
    turns: number;
    people: number;
    conversations: number;
    tokens: number;
    cost_usd: number;
    resolution_rate: number | null;
  };
  by_agent: {
    agent: string;
    name: string;
    turns: number;
    resolved: number;
    cost_usd: number;
    tokens: number;
    feedback: number;
  }[];
  by_unit: { unit: string; turns: number; cost_usd: number }[];
  security_events: Record<string, number>;
  guardrails: { name: string; outcome: string; count: number }[];
  unanswered: { agent: string; question: string; at: string }[];
}

export interface AuditEvent {
  id: number;
  ts: string;
  type: string;
  actor: string | null;
  actor_name: string | null;
  subject: string | null;
  subject_name: string | null;
  conversation: string | null;
  request: string | null;
  payload: unknown;
  hash: string;
  prev_hash: string | null;
}

export interface AuditPage {
  events: AuditEvent[];
  types: Record<string, number>;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  broken_at: number | null;
  reason: string;
}

export interface Policy {
  key: string;
  /** Stored as `{enabled: bool}` or `{value: …}` depending on the policy. */
  value: Record<string, unknown>;
  description: string;
  updated_by: string | null;
  updated_at: string;
}

export interface ConsoleConversation {
  id: string;
  unit: string;
  created_at: string;
  updated_at: string;
  messages: number;
  sensitive: boolean;
  agents: string[];
}

export interface TranscriptAccess {
  owner: string;
  expires_in_minutes: number;
  messages: StoredMessage[];
}

// --------------------------------------------------------------------------- agent studio
export interface StudioToolInfo {
  name: string;
  title: string;
  description: string;
  risk: 'read' | 'write' | 'sensitive' | string;
  subject: string;
  requires_governance_review: boolean;
  allowed_in_studio: boolean;
}

export interface StudioKnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  audience: AgentAudience | null;
}

export interface StudioUnit {
  id: string;
  name: string;
  parent_id: string | null;
}

export interface StudioCatalog {
  tools: StudioToolInfo[];
  knowledge_bases: StudioKnowledgeBase[];
  units: StudioUnit[];
  roles: string[];
}

export interface AgentAudience {
  type: 'all' | 'roles' | 'units';
  roles?: string[];
  units?: string[];
}

export interface EvaluationCase {
  kind: 'routing' | 'citation' | 'refusal';
  question: string;
  expect_kb?: string;
}

export interface AgentSpec {
  name: string;
  description: string;
  instructions: string;
  tone: string;
  icon: string;
  audience: AgentAudience;
  tools: string[];
  knowledge: string[];
  origin?: string;
  routing: { keywords: string[]; examples: string[] };
  evaluation: EvaluationCase[];
  risk?: 'low' | 'high' | string;
}

export interface EvaluationResult {
  passed: number;
  total: number;
  ok: boolean;
  ran_at: string;
  version: number;
  results: { kind: string; question: string; passed: boolean; detail: string }[];
}

export interface AgentVersion {
  version: number;
  status: string;
  spec: AgentSpec;
  created_by: string;
  created_by_name?: string | null;
  created_at: string;
  submitted_at: string | null;
  eval_result: EvaluationResult | null;
  reviewed_by: string | null;
  reviewed_by_name?: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface AgentDetail {
  id: string;
  owner_id: string;
  status: string;
  published_version: number | null;
  builtin: boolean;
  review_due: string | null;
  mine: boolean;
  versions: AgentVersion[];
}

export interface AgentListItem {
  id: string;
  name: string;
  description: string;
  icon: string;
  owner_id: string;
  owner_name: string;
  status: string;
  published_version: number | null;
  latest_version: number;
  latest_status: string;
  builtin: boolean;
  review_due: string | null;
  audience: AgentAudience | null;
  risk: string;
  mine: boolean;
}

export interface StudioDocument {
  kb: string;
  title: string;
  source: string;
  flags: string[];
  chunks: number;
  quarantined: boolean;
}

export interface StudioUploadResult {
  document_id: string;
  title: string;
  chunks: number;
  quarantined: boolean;
  signals: string[];
}

export interface StudioMetrics {
  turns: number;
  resolved: number;
  people: number;
  cost_usd: number;
  resolution_rate: number | null;
  feedback_positive: number;
  feedback_negative: number;
  unanswered: { question: string; at: string }[];
}

/** Error carrying the back-end error code so the UI can branch (e.g. step_up_required). */
export class TransportError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'TransportError';
    this.status = status;
    this.code = code;
  }
}

export interface Transport {
  mode: 'http' | 'demo';
  personas(): Promise<Persona[]>;
  login(employeeId: string): Promise<void>;
  logout(): void;
  me(): Promise<Me>;
  chat(req: ChatRequest, signal?: AbortSignal): AsyncIterable<StreamEvent>;
  confirmProposal(id: string, token: string): Promise<ProposalResult>;
  cancelProposal(id: string): Promise<void>;
  stepUpChallenge(): Promise<{ delivery: string; code?: string; message: string }>;
  stepUp(code: string): Promise<void>;
  conversations(): Promise<ConversationSummary[]>;
  messages(conversationId: string): Promise<StoredMessage[]>;
  upload(file: File): Promise<UploadResult>;
  download(path: string, filename: string): Promise<void>;
  feedback(messageId: string, rating: 1 | -1, agentId?: string): Promise<void>;

  consoleOverview(): Promise<ConsoleOverview>;
  consoleAudit(q: { type?: string; before?: number }): Promise<AuditPage>;
  consoleVerify(): Promise<ChainVerification>;
  consolePolicies(): Promise<Policy[]>;
  consoleUpdatePolicy(key: string, value: unknown): Promise<{ key: string; value: Record<string, unknown> }>;
  consoleConversations(): Promise<ConsoleConversation[]>;
  consoleTranscript(id: string, justification: string): Promise<TranscriptAccess>;

  studioCatalog(): Promise<StudioCatalog>;
  studioAgents(): Promise<AgentListItem[]>;
  studioAgent(id: string): Promise<AgentDetail>;
  studioCreate(spec: AgentSpec): Promise<AgentDetail>;
  studioUpdate(id: string, spec: AgentSpec): Promise<AgentDetail>;
  studioDocuments(id: string): Promise<StudioDocument[]>;
  studioUpload(id: string, file: File): Promise<StudioUploadResult>;
  studioEvaluate(id: string): Promise<EvaluationResult>;
  studioSubmit(id: string): Promise<AgentDetail>;
  studioReview(id: string, decision: 'approve' | 'reject', note: string): Promise<AgentDetail>;
  studioStatus(id: string, status: 'paused' | 'published' | 'archived'): Promise<AgentDetail>;
  studioRollback(id: string, version: number): Promise<AgentDetail>;
  studioMetrics(id: string): Promise<StudioMetrics>;
}
