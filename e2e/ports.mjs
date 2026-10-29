import path from 'node:path';

// Ports away from the dev defaults (4000/5173) so a running dev stack does not interfere.
export const API_PORT = 4100;
export const WEB_PORT = 5199;
export const MOCK_ANTHROPIC_PORT = 4199;
/**
 * Written by stack.mjs: { mongoUri } for tests that need direct DB access. Resolved from the
 * repository root, where Playwright and the stack script both run (this file is also loaded
 * from the CommonJS-compiled Playwright config, so it cannot use import.meta).
 */
export const STACK_FILE = path.resolve(process.cwd(), 'e2e/.stack.json');
