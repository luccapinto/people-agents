-- Row-level security, helper functions, grants and the hash-chained audit log.
--
-- The only identity input is the transaction-local setting app.employee_id. Everything
-- else (chain of command, HRBP coverage, platform roles, policy switches) is derived here,
-- inside the database, by SECURITY DEFINER helpers with a pinned search_path. The runtime
-- role atrium_app owns nothing and has no BYPASSRLS, so these policies always apply to it.

-- --------------------------------------------------------------------------- helpers
CREATE FUNCTION hr.current_employee() RETURNS text
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.employee_id', true), '') $$;

CREATE FUNCTION hr.in_chain(p_manager text, p_subject text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hr AS $$
    WITH RECURSIVE up(id, manager_id, depth) AS (
        SELECT id, manager_id, 0 FROM hr.employees WHERE id = p_subject
        UNION ALL
        SELECT e.id, e.manager_id, up.depth + 1 FROM hr.employees e JOIN up ON e.id = up.manager_id WHERE up.depth < 32
    )
    SELECT p_manager IS NOT NULL AND p_manager <> p_subject AND EXISTS (SELECT 1 FROM up WHERE manager_id = p_manager)
$$;

CREATE FUNCTION hr.hrbp_covers(p_hrbp text, p_subject text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hr AS $$
    WITH RECURSIVE up(id, parent_id, depth) AS (
        SELECT u.id, u.parent_id, 0 FROM hr.units u JOIN hr.employees e ON e.unit_id = u.id WHERE e.id = p_subject
        UNION ALL
        SELECT u.id, u.parent_id, up.depth + 1 FROM hr.units u JOIN up ON u.id = up.parent_id WHERE up.depth < 32
    )
    SELECT p_hrbp IS NOT NULL AND p_hrbp <> p_subject
       AND EXISTS (SELECT 1 FROM hr.hrbp_assignments a WHERE a.hrbp_id = p_hrbp AND a.unit_id IN (SELECT id FROM up))
$$;

CREATE FUNCTION hr.has_role(p_employee text, p_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hr AS $$
    SELECT EXISTS (SELECT 1 FROM hr.platform_roles WHERE employee_id = p_employee AND role = p_role)
$$;

CREATE FUNCTION app.policy_enabled(p_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
    SELECT coalesce((SELECT (value ->> 'enabled')::boolean FROM app.policies WHERE key = p_key), false)
$$;


-- Governance switches are configuration, not secrets: readable without an identity.
CREATE FUNCTION app.policy_values() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app AS $$
    SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM app.policies
$$;
-- Identity snapshot used by the authentication layer to build IdentityContext.
CREATE FUNCTION hr.identity(p_employee text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hr AS $$
    WITH RECURSIVE
    me AS (SELECT * FROM hr.employees WHERE id = p_employee AND status = 'active'),
    down(id, depth) AS (
        SELECT id, 1 FROM hr.employees WHERE manager_id = p_employee AND status = 'active'
        UNION ALL
        SELECT e.id, d.depth + 1 FROM hr.employees e JOIN down d ON e.manager_id = d.id WHERE e.status = 'active' AND d.depth < 32
    ),
    up(id, parent_id, depth) AS (
        SELECT u.id, u.parent_id, 0 FROM hr.units u JOIN me ON u.id = me.unit_id
        UNION ALL
        SELECT u.id, u.parent_id, up.depth + 1 FROM hr.units u JOIN up ON u.id = up.parent_id WHERE up.depth < 32
    )
    SELECT jsonb_build_object(
        'id', me.id, 'name', me.name, 'email', me.email, 'title', me.title, 'unit_id', me.unit_id,
        'manager_id', me.manager_id, 'location', me.location, 'hire_date', me.hire_date,
        'unit_path', coalesce((SELECT jsonb_agg(id ORDER BY depth DESC) FROM up), '[]'::jsonb),
        'direct_reports', coalesce((SELECT jsonb_agg(id ORDER BY id) FROM hr.employees WHERE manager_id = me.id AND status = 'active'), '[]'::jsonb),
        'chain_reports', coalesce((SELECT jsonb_agg(id ORDER BY id) FROM down), '[]'::jsonb),
        'hrbp_units', coalesce((SELECT jsonb_agg(unit_id ORDER BY unit_id) FROM hr.hrbp_assignments WHERE hrbp_id = me.id), '[]'::jsonb),
        'platform_roles', coalesce((SELECT jsonb_agg(role ORDER BY role) FROM hr.platform_roles WHERE employee_id = me.id), '[]'::jsonb)
    ) FROM me
$$;

-- Names of active employees (company directory) for the output leak guardrail.
CREATE FUNCTION hr.directory_names() RETURNS TABLE (id text, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hr AS $$
    SELECT id, name FROM hr.employees WHERE status = 'active'
$$;

CREATE FUNCTION hr.employee_id_for_email(p_email text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, hr AS $$
    SELECT id FROM hr.employees WHERE lower(email) = lower(p_email) AND status = 'active'
$$;

CREATE FUNCTION app.has_transcript_grant(p_conversation uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, hr AS $$
    SELECT EXISTS (
        SELECT 1 FROM app.transcript_grants g
        WHERE g.conversation_id = p_conversation AND g.grantee_id = hr.current_employee() AND g.expires_at > now()
    ) AND hr.has_role(hr.current_employee(), 'governance_admin')
$$;

CREATE FUNCTION app.kb_visible(p_kb text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, app, hr AS $$
    WITH RECURSIVE me AS (SELECT * FROM hr.employees WHERE id = hr.current_employee()),
    up(id, parent_id, depth) AS (
        SELECT u.id, u.parent_id, 0 FROM hr.units u JOIN me ON u.id = me.unit_id
        UNION ALL
        SELECT u.id, u.parent_id, up.depth + 1 FROM hr.units u JOIN up ON u.id = up.parent_id WHERE up.depth < 32
    )
    SELECT EXISTS (SELECT 1 FROM me) AND (
        hr.has_role(hr.current_employee(), 'governance_admin')
        OR EXISTS (
            SELECT 1 FROM app.knowledge_bases kb WHERE kb.id = p_kb AND (
                kb.owner_id = hr.current_employee()
                OR kb.audience ->> 'type' = 'all'
                OR (kb.audience ->> 'type' = 'units'
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(kb.audience -> 'units') u WHERE u IN (SELECT id FROM up)))
                OR (kb.audience ->> 'type' = 'roles' AND (
                    (kb.audience -> 'roles' ? 'manager' AND EXISTS (SELECT 1 FROM hr.employees r WHERE r.manager_id = hr.current_employee() AND r.status = 'active'))
                    OR (kb.audience -> 'roles' ? 'hrbp' AND EXISTS (SELECT 1 FROM hr.hrbp_assignments a WHERE a.hrbp_id = hr.current_employee()))
                ))
            )
        )
    )
$$;

-- --------------------------------------------------------------------------- RLS: hr
DO $$
DECLARE t text;
BEGIN
    -- Directory and public catalogs: any authenticated employee.
    FOREACH t IN ARRAY ARRAY['employees', 'units', 'benefit_plans', 'trainings', 'learning_paths', 'review_cycles', 'job_postings'] LOOP
        EXECUTE format('ALTER TABLE hr.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY authenticated_read ON hr.%I FOR SELECT TO atrium_app USING (hr.current_employee() IS NOT NULL)', t);
    END LOOP;

    -- Personal data: the employee only.
    FOREACH t IN ARRAY ARRAY['employee_private', 'dependents', 'benefit_enrollments', 'plan_change_requests', 'benefit_balances',
                             'bank_accounts', 'addresses', 'reimbursements', 'documents_issued', 'employee_skills'] LOOP
        EXECUTE format('ALTER TABLE hr.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('CREATE POLICY self_only ON hr.%I TO atrium_app USING (employee_id = hr.current_employee()) WITH CHECK (employee_id = hr.current_employee())', t);
    END LOOP;

    -- Compensation: the employee; the chain manager only if the governance switch is on.
    FOREACH t IN ARRAY ARRAY['compensation', 'payslips', 'income_statements', 'plr'] LOOP
        EXECUTE format('ALTER TABLE hr.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format($p$CREATE POLICY self_or_switch ON hr.%I FOR SELECT TO atrium_app USING (
            employee_id = hr.current_employee()
            OR (app.policy_enabled('manager_can_view_team_compensation') AND hr.in_chain(hr.current_employee(), employee_id)))$p$, t);
    END LOOP;

    -- Vacation, time and development data: the employee, the chain manager, the covering HRBP.
    FOREACH t IN ARRAY ARRAY['vacation_periods', 'vacation_requests', 'leave_requests', 'absences', 'time_bank', 'time_adjustments',
                             'training_assignments', 'onboarding_tasks', 'buddies'] LOOP
        EXECUTE format('ALTER TABLE hr.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format($p$CREATE POLICY team_read ON hr.%I FOR SELECT TO atrium_app USING (
            employee_id = hr.current_employee()
            OR hr.in_chain(hr.current_employee(), employee_id)
            OR hr.hrbp_covers(hr.current_employee(), employee_id))$p$, t);
    END LOOP;

    -- Writes of team data: the employee for themself; managers may update their chain (decisions).
    FOREACH t IN ARRAY ARRAY['vacation_requests', 'leave_requests', 'time_adjustments', 'onboarding_tasks'] LOOP
        EXECUTE format('CREATE POLICY self_insert ON hr.%I FOR INSERT TO atrium_app WITH CHECK (employee_id = hr.current_employee())', t);
        EXECUTE format($p$CREATE POLICY self_or_manager_update ON hr.%I FOR UPDATE TO atrium_app
            USING (employee_id = hr.current_employee() OR hr.in_chain(hr.current_employee(), employee_id))
            WITH CHECK (employee_id = hr.current_employee() OR hr.in_chain(hr.current_employee(), employee_id))$p$, t);
    END LOOP;
END $$;

-- --------------------------------------------------------------------------- RLS: app
ALTER TABLE app.policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY read_all ON app.policies FOR SELECT TO atrium_app USING (hr.current_employee() IS NOT NULL);
CREATE POLICY governance_write ON app.policies FOR UPDATE TO atrium_app
    USING (hr.has_role(hr.current_employee(), 'governance_admin')) WITH CHECK (hr.has_role(hr.current_employee(), 'governance_admin'));

ALTER TABLE app.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_or_grant_read ON app.conversations FOR SELECT TO atrium_app
    USING (owner_id = hr.current_employee() OR app.has_transcript_grant(id));
CREATE POLICY owner_write ON app.conversations FOR ALL TO atrium_app
    USING (owner_id = hr.current_employee()) WITH CHECK (owner_id = hr.current_employee());

ALTER TABLE app.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_or_grant_read ON app.messages FOR SELECT TO atrium_app
    USING (owner_id = hr.current_employee() OR app.has_transcript_grant(conversation_id));
CREATE POLICY owner_write ON app.messages FOR ALL TO atrium_app
    USING (owner_id = hr.current_employee()) WITH CHECK (owner_id = hr.current_employee());

ALTER TABLE app.transcript_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_grants ON app.transcript_grants TO atrium_app
    USING (grantee_id = hr.current_employee())
    WITH CHECK (grantee_id = hr.current_employee() AND hr.has_role(hr.current_employee(), 'governance_admin'));

ALTER TABLE app.proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY actor_only ON app.proposals TO atrium_app
    USING (actor_id = hr.current_employee()) WITH CHECK (actor_id = hr.current_employee());

ALTER TABLE app.uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_only ON app.uploads TO atrium_app
    USING (owner_id = hr.current_employee()) WITH CHECK (owner_id = hr.current_employee());

ALTER TABLE app.step_ups ENABLE ROW LEVEL SECURITY;
CREATE POLICY self_only ON app.step_ups TO atrium_app
    USING (employee_id = hr.current_employee()) WITH CHECK (employee_id = hr.current_employee());

ALTER TABLE app.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY governance_read ON app.audit_events FOR SELECT TO atrium_app
    USING (hr.has_role(hr.current_employee(), 'governance_admin'));

ALTER TABLE app.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON app.agents FOR SELECT TO atrium_app USING (
    hr.current_employee() IS NOT NULL AND (
        status IN ('published', 'paused') OR owner_id = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin')));
CREATE POLICY author_insert ON app.agents FOR INSERT TO atrium_app WITH CHECK (
    owner_id = hr.current_employee() AND (hr.has_role(owner_id, 'agent_author') OR hr.has_role(owner_id, 'governance_admin')));
CREATE POLICY owner_or_governance_update ON app.agents FOR UPDATE TO atrium_app
    USING (owner_id = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin'))
    WITH CHECK (owner_id = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin'));

ALTER TABLE app.agent_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON app.agent_versions FOR SELECT TO atrium_app USING (
    EXISTS (SELECT 1 FROM app.agents a WHERE a.id = agent_id)
    AND (status = 'published' OR created_by = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin')
         OR EXISTS (SELECT 1 FROM app.agents a WHERE a.id = agent_id AND a.owner_id = hr.current_employee())));
CREATE POLICY author_insert ON app.agent_versions FOR INSERT TO atrium_app WITH CHECK (
    created_by = hr.current_employee()
    AND EXISTS (SELECT 1 FROM app.agents a WHERE a.id = agent_id AND (a.owner_id = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin'))));
CREATE POLICY owner_or_governance_update ON app.agent_versions FOR UPDATE TO atrium_app
    USING (EXISTS (SELECT 1 FROM app.agents a WHERE a.id = agent_id AND (a.owner_id = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin'))));

ALTER TABLE app.knowledge_bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON app.knowledge_bases FOR SELECT TO atrium_app USING (app.kb_visible(id));
CREATE POLICY author_write ON app.knowledge_bases FOR INSERT TO atrium_app WITH CHECK (owner_id = hr.current_employee());
ALTER TABLE app.kb_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON app.kb_documents FOR SELECT TO atrium_app USING (app.kb_visible(kb_id));
CREATE POLICY owner_write ON app.kb_documents FOR INSERT TO atrium_app WITH CHECK (
    EXISTS (SELECT 1 FROM app.knowledge_bases kb WHERE kb.id = kb_id AND (kb.owner_id = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin'))));
ALTER TABLE app.kb_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY visible ON app.kb_chunks FOR SELECT TO atrium_app USING (app.kb_visible(kb_id));
CREATE POLICY owner_write ON app.kb_chunks FOR INSERT TO atrium_app WITH CHECK (
    EXISTS (SELECT 1 FROM app.knowledge_bases kb WHERE kb.id = kb_id AND (kb.owner_id = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin'))));

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['usage', 'feedback'] LOOP
        EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format($p$CREATE POLICY own_or_governance ON app.%I FOR SELECT TO atrium_app
            USING (employee_id = hr.current_employee() OR hr.has_role(hr.current_employee(), 'governance_admin'))$p$, t);
        EXECUTE format('CREATE POLICY own_insert ON app.%I FOR INSERT TO atrium_app WITH CHECK (employee_id = hr.current_employee())', t);
    END LOOP;
END $$;
ALTER TABLE app.tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_or_governance ON app.tickets FOR SELECT TO atrium_app
    USING (employee_id = hr.current_employee() OR (NOT sensitive AND hr.has_role(hr.current_employee(), 'governance_admin')));
CREATE POLICY own_insert ON app.tickets FOR INSERT TO atrium_app WITH CHECK (employee_id = hr.current_employee());
ALTER TABLE app.unanswered ENABLE ROW LEVEL SECURITY;
CREATE POLICY governance_read ON app.unanswered FOR SELECT TO atrium_app USING (hr.has_role(hr.current_employee(), 'governance_admin'));
CREATE POLICY authenticated_insert ON app.unanswered FOR INSERT TO atrium_app WITH CHECK (hr.current_employee() IS NOT NULL);

-- --------------------------------------------------------------------------- audit chain
CREATE FUNCTION app.audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'app.audit_events is append-only';
END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON app.audit_events
    FOR EACH ROW EXECUTE FUNCTION app.audit_immutable();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON app.audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION app.audit_immutable();

-- Canonical form hashed for each event (reproduced by atrium.runtime.audit.verify_chain):
-- prev_hash|id|ts(UTC, microseconds)|type|actor|subject|conversation|request|payload::text
CREATE FUNCTION app.append_audit(p_type text, p_actor text, p_subject text, p_conversation text, p_request text, p_payload jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, app AS $$
DECLARE
    v_prev text;
    v_id bigint;
    v_ts timestamptz := clock_timestamp();
    v_hash text;
BEGIN
    PERFORM pg_advisory_xact_lock(727274);
    SELECT hash INTO v_prev FROM app.audit_events ORDER BY id DESC LIMIT 1;
    v_prev := coalesce(v_prev, repeat('0', 64));
    v_id := nextval(pg_get_serial_sequence('app.audit_events', 'id'));
    v_hash := encode(sha256(convert_to(concat_ws('|',
        v_prev, v_id::text, to_char(v_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), p_type,
        coalesce(p_actor, ''), coalesce(p_subject, ''), coalesce(p_conversation, ''), coalesce(p_request, ''),
        coalesce(p_payload, '{}'::jsonb)::text), 'UTF8')), 'hex');
    INSERT INTO app.audit_events (id, ts, type, actor_id, subject_id, conversation_id, request_id, payload, prev_hash, hash)
    VALUES (v_id, v_ts, p_type, p_actor, p_subject, p_conversation, p_request, coalesce(p_payload, '{}'::jsonb), v_prev, v_hash);
    RETURN v_id;
END $$;

-- --------------------------------------------------------------------------- grants
GRANT USAGE ON SCHEMA hr, app TO atrium_app;
GRANT SELECT ON ALL TABLES IN SCHEMA hr TO atrium_app;
REVOKE ALL ON hr.hrbp_assignments, hr.platform_roles FROM atrium_app;
GRANT INSERT, UPDATE ON hr.vacation_requests, hr.leave_requests, hr.time_adjustments, hr.plan_change_requests,
    hr.dependents, hr.bank_accounts, hr.addresses, hr.reimbursements, hr.documents_issued, hr.onboarding_tasks,
    hr.benefit_enrollments TO atrium_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA hr TO atrium_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO atrium_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.conversations, app.messages TO atrium_app;
GRANT SELECT, INSERT, UPDATE ON app.proposals, app.step_ups, app.agents, app.agent_versions, app.uploads TO atrium_app;
GRANT SELECT, UPDATE ON app.policies TO atrium_app;
GRANT SELECT ON app.audit_events TO atrium_app;
GRANT SELECT, INSERT ON app.usage, app.feedback, app.unanswered, app.tickets, app.transcript_grants TO atrium_app;
GRANT SELECT, INSERT, DELETE ON app.knowledge_bases, app.kb_documents, app.kb_chunks TO atrium_app;
REVOKE ALL ON FUNCTION app.append_audit(text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.append_audit(text, text, text, text, text, jsonb) TO atrium_app;
