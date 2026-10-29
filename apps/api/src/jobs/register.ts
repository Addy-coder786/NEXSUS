/**
 * Imports every module that calls defineJob() / events.on() so their side effects are
 * registered exactly once. Imported from app.ts.
 *
 * Modules append their listener/handler file here when they add one.
 */
import '../modules/notifications/notification.listeners';
import '../modules/chat/chat.listeners';
import '../modules/realtime/realtime.listeners';
import '../modules/integrations/slack/slack.listeners';
import '../modules/analytics/deadline.job';
import '../modules/ai/ai.listeners';
import '../modules/rag/rag.listeners';
import '../modules/meetings/meeting.service';
