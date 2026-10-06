/**
 * Imported first by slack.test.ts so `features.slackIntegration` is true when config/env loads.
 * (Imports execute in order, so a side-effect module is more reliable than inline assignments.)
 */
process.env.SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID ?? 'slack-client-id';
process.env.SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET ?? 'slack-client-secret';
process.env.SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? 'slack-signing-secret';

export {};
