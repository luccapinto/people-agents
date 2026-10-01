import type { ComponentType } from 'react';

export interface CardProps {
  /** Raw tool payload; each card casts it to its own declared shape. */
  data: unknown;
  agentName?: string;
}

export type CardComponent = ComponentType<CardProps>;

/** The back-end owns these payload shapes (see backend/atrium/tools/*.py). */
export function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}
