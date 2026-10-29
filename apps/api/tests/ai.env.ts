/**
 * Imported first by AI test files so `features.ai` is true when config/env loads.
 * The SDK client itself is replaced by FakeClaude, so the key is never used.
 */
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'sk-ant-test';

export {};
