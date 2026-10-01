import { HttpTransport } from './http';
import type { Transport } from './types';

/** Single entry point for every UI call. A DemoTransport will be selected here later
 *  (behind `import.meta.env.VITE_DEMO`); components must never call `fetch` directly. */
export const transport: Transport = new HttpTransport();

export { HttpTransport };
export * from './types';
