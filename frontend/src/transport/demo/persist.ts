/** localStorage persistence for everything the demo mutates.
 *
 *  Only mutable tables are stored (the read-only bulk of the dataset is re-imported from the
 *  bundled JSON), so a session fits well inside the storage quota. */
import type { Services } from './runtime/services';

export const STORAGE_KEY = 'atrium.demo.state';
export const SESSION_KEY = 'atrium.token';

interface Snapshot {
  version: 1;
  hr: Record<string, unknown[]>;
  app: Record<string, unknown[]>;
  policies: unknown[];
  agents: { rows: unknown[]; versions: unknown[] };
  kb: { bases: unknown[]; documents: unknown[]; chunks: unknown[] };
  seq: { ticket: number };
}

function replace<T>(target: T[], rows: unknown[]): void {
  target.length = 0;
  target.push(...(rows as T[]));
}

export function snapshot(s: Services): Snapshot {
  const studioDocs = s.kb.documents.filter((doc) => doc.uploaded_by !== null);
  const studioDocIds = new Set(studioDocs.map((doc) => doc.id));
  return {
    version: 1,
    hr: {
      vacationRequests: s.store.vacationRequests,
      leaveRequests: s.store.leaveRequests,
      planChanges: s.store.planChanges,
      dependents: s.store.dependents,
      enrollments: s.store.enrollments,
      timeAdjustments: s.store.timeAdjustments,
      reimbursements: s.store.reimbursements,
      addresses: s.store.addresses,
      bankAccounts: s.store.bankAccounts,
      onboardingTasks: s.store.onboardingTasks,
      issuedDocuments: s.store.issuedDocuments,
    },
    app: {
      conversations: s.conversations.conversations,
      messages: s.conversations.messages,
      usage: s.conversations.usage,
      feedback: s.conversations.feedback,
      unanswered: s.conversations.unanswered,
      proposals: s.proposals.rows,
      stepUps: [...s.proposals.stepUps.entries()],
      tickets: s.tickets,
      uploads: s.uploads,
      audit: s.audit.events,
    },
    policies: [...s.store.policies.values()],
    agents: { rows: s.agents.agents, versions: s.agents.versions },
    kb: {
      bases: s.kb.bases.filter((b) => b.id.startsWith('agente-')),
      documents: studioDocs,
      chunks: s.kb.chunks.filter((c) => studioDocIds.has(c.document_id)),
    },
    seq: { ticket: s.ticketSequence },
  };
}

export function save(s: Services): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot(s)));
  } catch {
    // Quota exceeded or storage disabled: the demo keeps working in memory.
  }
}

export function load(s: Services): boolean {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  let data: Snapshot;
  try {
    data = JSON.parse(raw) as Snapshot;
  } catch {
    return false;
  }
  if (data.version !== 1) return false;
  replace(s.store.vacationRequests, data.hr.vacationRequests);
  replace(s.store.leaveRequests, data.hr.leaveRequests);
  replace(s.store.planChanges, data.hr.planChanges);
  replace(s.store.dependents, data.hr.dependents);
  replace(s.store.enrollments, data.hr.enrollments);
  replace(s.store.timeAdjustments, data.hr.timeAdjustments);
  replace(s.store.reimbursements, data.hr.reimbursements);
  replace(s.store.addresses, data.hr.addresses);
  replace(s.store.bankAccounts, data.hr.bankAccounts);
  replace(s.store.onboardingTasks, data.hr.onboardingTasks);
  replace(s.store.issuedDocuments, data.hr.issuedDocuments);
  replace(s.conversations.conversations, data.app.conversations);
  replace(s.conversations.messages, data.app.messages);
  replace(s.conversations.usage, data.app.usage);
  replace(s.conversations.feedback, data.app.feedback);
  replace(s.conversations.unanswered, data.app.unanswered);
  replace(s.proposals.rows, data.app.proposals);
  s.proposals.stepUps.clear();
  for (const [k, v] of data.app.stepUps as [string, number][]) s.proposals.stepUps.set(k, v);
  replace(s.tickets, data.app.tickets);
  replace(s.uploads, data.app.uploads);
  s.audit.restore(data.app.audit as never[]);
  s.store.policies.clear();
  for (const row of data.policies as { key: string }[]) {
    s.store.policies.set(row.key, row as never);
  }
  replace(s.agents.agents, data.agents.rows);
  replace(s.agents.versions, data.agents.versions);
  const baseIds = new Set(s.kb.bases.map((b) => b.id));
  for (const b of data.kb.bases as { id: string }[]) if (!baseIds.has(b.id)) s.kb.bases.push(b as never);
  const docIds = new Set(s.kb.documents.map((doc) => doc.id));
  for (const doc of data.kb.documents as { id: string }[]) if (!docIds.has(doc.id)) s.kb.documents.push(doc as never);
  const chunkIds = new Set(s.kb.chunks.map((c) => c.id));
  for (const c of data.kb.chunks as { id: string }[]) if (!chunkIds.has(c.id)) s.kb.chunks.push(c as never);
  s.kb.rebuild();
  s.restoreSequences(data.seq.ticket);
  s.store.restoreSequences();
  return true;
}

export function clear(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
