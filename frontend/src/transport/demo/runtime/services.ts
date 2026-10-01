/** Composition root: one engine instance wiring store, policies, guardrails and runtime. */
import { PolicyEngine, type PolicyRow, DEFAULT_POLICIES } from '../authz/policy';
import { type Day, fromISO } from '../core/date';
import { HRSession, Store } from '../data/store';
import type { Catalog, Dataset, KbData, LexiconData, LifeEvent, ToolMeta } from '../data/types';
import { GuardrailPipeline } from '../guardrails/pipeline';
import { AgentDirectory } from './agents';
import { AuditLog } from './audit';
import { ConversationStore } from './conversations';
import { KnowledgeService } from './knowledge';
import { ProposalService } from './proposals';
import { allTools, setToolCatalog } from './registry';
import type { Branding } from './prompts';
import type { ReimbursementPolicy } from './receipts';
import type { Tool } from './tool';

export const REFERENCE_TODAY = '2026-10-01';

export interface UploadRow {
  id: string;
  owner_id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  text_content: string;
  created_at: string;
}

export interface TicketRow {
  id: string;
  employee_id: string;
  agent_id: string | null;
  category: string;
  summary: string;
  status: string;
  sensitive: boolean;
  created_at: string;
}

export interface TranscriptGrant {
  conversation_id: string;
  grantee_id: string;
  justification: string;
  expires_at: number;
}

export class Services {
  readonly store: Store;
  readonly policy: PolicyEngine;
  readonly audit = new AuditLog();
  readonly agents = new AgentDirectory();
  readonly kb: KnowledgeService;
  readonly conversations = new ConversationStore();
  readonly guardrails: GuardrailPipeline;
  readonly proposals: ProposalService;
  readonly uploads: UploadRow[] = [];
  readonly tickets: TicketRow[] = [];
  readonly transcriptGrants: TranscriptGrant[] = [];
  readonly today: Day;
  private ticketSeq = 1199;

  constructor(
    readonly dataset: Dataset,
    readonly catalog: Catalog,
    readonly kbData: KbData,
    readonly branding: Branding,
  ) {
    this.store = new Store(dataset);
    this.kb = new KnowledgeService(kbData.chunks);
    for (const [key, value, description] of DEFAULT_POLICIES) {
      const row: PolicyRow = {
        key,
        value: { ...value },
        description,
        updated_by: null,
        updated_at: new Date().toISOString(),
      };
      this.store.policies.set(key, row);
    }
    this.policy = new PolicyEngine(this.store.policyStore);
    this.guardrails = new GuardrailPipeline(this.store.policyStore, () => [...this.store.directoryNames().values()]);
    this.proposals = new ProposalService(this);
    this.today = fromISO(REFERENCE_TODAY);
    setToolCatalog(catalog.tools);
  }

  session(employeeId: string): HRSession {
    return new HRSession(this.store, employeeId);
  }

  tools(): Record<string, Tool> {
    return allTools();
  }

  companyPolicies(): Record<string, Record<string, unknown>> {
    return this.catalog.company_policies;
  }

  /** `company_policies.yaml` → reimbursement, exported by the back-end with this shape. */
  reimbursementPolicy(): ReimbursementPolicy {
    return this.catalog.company_policies.reimbursement as unknown as ReimbursementPolicy;
  }

  toolCatalog(): Record<string, ToolMeta> {
    return this.catalog.tools;
  }

  lifeEvents(): Record<string, LifeEvent> {
    return this.catalog.life_events.events;
  }

  lexicon(): LexiconData {
    return this.catalog.lexicon ?? {};
  }

  directory(): Map<string, string> {
    return this.store.directoryNames();
  }

  directoryName(employeeId: string | null): string | null {
    return employeeId ? (this.store.directoryNames().get(employeeId) ?? null) : null;
  }

  nextTicketId(): string {
    this.ticketSeq += 1;
    return `CH-${this.ticketSeq}`;
  }

  get ticketSequence(): number {
    return this.ticketSeq;
  }

  restoreSequences(ticket: number): void {
    this.ticketSeq = Math.max(this.ticketSeq, ticket);
  }
}
