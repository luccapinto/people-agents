-- Platform data: conversations, proposals, audit, agents, knowledge, usage.
CREATE SCHEMA app;

CREATE TABLE app.policies (
    key text PRIMARY KEY,
    value jsonb NOT NULL,
    description text NOT NULL DEFAULT '',
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id text NOT NULL REFERENCES hr.employees(id),
    title text NOT NULL DEFAULT 'Nova conversa',
    playground_agent text,
    sensitive boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.conversations (owner_id, updated_at DESC);

CREATE TABLE app.messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES app.conversations(id) ON DELETE CASCADE,
    owner_id text NOT NULL,
    role text NOT NULL CHECK (role IN ('user', 'assistant')),
    content text NOT NULL,
    redacted boolean NOT NULL DEFAULT false,
    payload jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.messages (conversation_id, created_at);

CREATE TABLE app.transcript_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES app.conversations(id) ON DELETE CASCADE,
    grantee_id text NOT NULL REFERENCES hr.employees(id),
    justification text NOT NULL CHECK (length(justification) >= 20),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE TABLE app.proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id text NOT NULL REFERENCES hr.employees(id),
    subject_id text NOT NULL REFERENCES hr.employees(id),
    tool text NOT NULL,
    agent_id text NOT NULL,
    args jsonb NOT NULL,
    summary text NOT NULL,
    details jsonb NOT NULL DEFAULT '[]',
    risk text NOT NULL CHECK (risk IN ('write', 'sensitive')),
    token_hash text NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'executed', 'cancelled', 'failed')),
    conversation_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    decided_at timestamptz,
    result jsonb
);

CREATE TABLE app.step_ups (
    employee_id text PRIMARY KEY REFERENCES hr.employees(id),
    verified_at timestamptz NOT NULL
);

-- Append-only, hash-chained. Writes only through app.append_audit().
CREATE TABLE app.audit_events (
    id bigserial PRIMARY KEY,
    ts timestamptz NOT NULL DEFAULT now(),
    type text NOT NULL,
    actor_id text,
    subject_id text,
    conversation_id text,
    request_id text,
    payload jsonb NOT NULL DEFAULT '{}',
    prev_hash text NOT NULL,
    hash text NOT NULL
);
CREATE INDEX ON app.audit_events (type);
CREATE INDEX ON app.audit_events (actor_id);

CREATE TABLE app.agents (
    id text PRIMARY KEY,
    owner_id text NOT NULL REFERENCES hr.employees(id),
    owner_unit text,
    status text NOT NULL CHECK (status IN ('draft', 'in_review', 'published', 'paused', 'archived')),
    published_version int,
    builtin boolean NOT NULL DEFAULT false,
    review_due date,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.agent_versions (
    agent_id text NOT NULL REFERENCES app.agents(id) ON DELETE CASCADE,
    version int NOT NULL,
    spec jsonb NOT NULL,
    status text NOT NULL CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'superseded', 'rejected')),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz,
    eval_result jsonb,
    reviewed_by text,
    reviewed_at timestamptz,
    review_note text,
    PRIMARY KEY (agent_id, version)
);

CREATE TABLE app.knowledge_bases (
    id text PRIMARY KEY,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    audience jsonb NOT NULL DEFAULT '{"type": "all"}',
    owner_id text REFERENCES hr.employees(id)
);

CREATE TABLE app.kb_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kb_id text NOT NULL REFERENCES app.knowledge_bases(id) ON DELETE CASCADE,
    title text NOT NULL,
    source text NOT NULL,
    mime text NOT NULL,
    sha256 text NOT NULL,
    flags jsonb NOT NULL DEFAULT '[]',
    uploaded_by text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kb_id, source)
);

CREATE TABLE app.kb_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id uuid NOT NULL REFERENCES app.kb_documents(id) ON DELETE CASCADE,
    kb_id text NOT NULL,
    ordinal int NOT NULL,
    heading text NOT NULL,
    content text NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', heading || ' ' || content)) STORED,
    embedding vector(384) NOT NULL
);
CREATE INDEX ON app.kb_chunks USING gin (tsv);
CREATE INDEX ON app.kb_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON app.kb_chunks (kb_id);

CREATE TABLE app.usage (
    id bigserial PRIMARY KEY,
    ts timestamptz NOT NULL DEFAULT now(),
    employee_id text NOT NULL,
    unit_id text,
    conversation_id uuid,
    agent_ids text[] NOT NULL DEFAULT '{}',
    model text NOT NULL,
    prompt_tokens int NOT NULL DEFAULT 0,
    completion_tokens int NOT NULL DEFAULT 0,
    cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
    resolved boolean NOT NULL DEFAULT true
);

CREATE TABLE app.feedback (
    id bigserial PRIMARY KEY,
    message_id uuid NOT NULL,
    employee_id text NOT NULL,
    agent_id text,
    rating int NOT NULL CHECK (rating IN (-1, 1)),
    comment text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.unanswered (
    id bigserial PRIMARY KEY,
    agent_id text,
    question text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.tickets (
    id text PRIMARY KEY,
    employee_id text NOT NULL REFERENCES hr.employees(id),
    agent_id text,
    category text NOT NULL,
    summary text NOT NULL,
    status text NOT NULL DEFAULT 'aberto',
    sensitive boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE SEQUENCE app.ticket_seq START 1200;
