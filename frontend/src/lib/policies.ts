import type { Policy } from '@/transport/types';

/** Editor shape per policy key, mirroring POLICY_RULES in backend/atrium/api/routes_admin.py. */
export type PolicyKind = 'switch' | 'number' | 'mode' | 'tags';

const KINDS: Record<string, PolicyKind> = {
  manager_can_view_team_compensation: 'switch',
  k_anonymity_min: 'number',
  retention_days: 'number',
  dlp_secrets_mode: 'mode',
  dlp_customer_data_mode: 'mode',
  blocked_topics: 'tags',
  user_daily_token_budget: 'number',
  user_rate_limit_per_minute: 'number',
  transcript_grant_minutes: 'number',
};

export const K_ANONYMITY_FLOOR = 5;

export function policyKind(key: string): PolicyKind {
  return KINDS[key] ?? 'number';
}

/** Policies are stored wrapped: `{enabled: bool}` for switches, `{value: …}` for the rest. */
export function policyValue(policy: Policy): unknown {
  const wrapper = policy.value ?? {};
  return policyKind(policy.key) === 'switch' ? wrapper.enabled : wrapper.value;
}

/**
 * Client-side mirror of the back-end validation so the person sees the problem before the
 * round trip. The API message always wins when it answers 422.
 */
export function validatePolicy(key: string, value: unknown): string | null {
  const kind = policyKind(key);
  if (kind === 'switch') {
    return typeof value === 'boolean' ? null : `${key} expects bool`;
  }
  if (kind === 'mode') {
    return value === 'warn' || value === 'block' ? null : 'modo deve ser warn ou block';
  }
  if (kind === 'tags') {
    return Array.isArray(value) && value.every((item) => typeof item === 'string')
      ? null
      : `${key} expects list`;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    return `${key} expects int`;
  }
  if (key === 'k_anonymity_min' && value < K_ANONYMITY_FLOOR) {
    return `k-anonimato não pode ser menor que ${K_ANONYMITY_FLOOR}`;
  }
  if (key === 'retention_days' && (value < 30 || value > 3650)) {
    return 'retenção entre 30 e 3650 dias';
  }
  if (value < 1) return 'valor deve ser positivo';
  return null;
}
