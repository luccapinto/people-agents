import data from '../../../config/branding.json';
import type { Branding } from '@/transport/types';

/** Product identity has a single source of truth in the repository root. */
export const branding = data as Branding;
