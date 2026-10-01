import { DemoTransport } from './demo';
import { HttpTransport } from './http';
import type { Transport } from './types';

/** Single entry point for every UI call. `VITE_DEMO` swaps the HTTP back-end for the
 *  in-browser demo engine; components must never call `fetch` directly. */
export const transport: Transport = import.meta.env.VITE_DEMO ? new DemoTransport() : new HttpTransport();

export const isDemo = transport.mode === 'demo';

export { DemoTransport, HttpTransport };
export * from './types';
