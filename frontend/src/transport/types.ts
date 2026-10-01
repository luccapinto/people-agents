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
  subject: string;
  subject_name: string;
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
}
