import { Router } from 'express';
import {
  commitGeneratedTasksSchema,
  conversationListQuerySchema,
  createConversationSchema,
  generateTasksSchema,
  idParamSchema,
  sendAiMessageSchema,
  summarizeSchema,
} from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireProjectAccess, requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { requireDocumentPermission } from '../documents/document.controller';
import { requireAi } from './ai.client';
import * as controller from './ai.controller';

/**
 * `/ai/*`. Every endpoint except GET /ai/status answers 503 AI_NOT_CONFIGURED when no LLM
 * credentials are configured (requireAi runs before any lookup).
 */
export const aiRoutes = Router();
aiRoutes.use(authenticate);

aiRoutes.get('/status', controller.status);

aiRoutes.use(requireAi);

// ---- workspace-level ----

aiRoutes.get(
  '/workspaces/:id/conversations',
  validate({ params: idParamSchema, query: conversationListQuerySchema }),
  requireWorkspacePermission('ai:use'),
  controller.listConversations,
);
aiRoutes.post(
  '/workspaces/:id/conversations',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: createConversationSchema }),
  requireWorkspacePermission('ai:use'),
  controller.createConversation,
);
aiRoutes.get(
  '/workspaces/:id/digest',
  validate({ params: idParamSchema, query: controller.digestQuerySchema }),
  requireWorkspacePermission('ai:use'),
  controller.workspaceDigest,
);
aiRoutes.post(
  '/workspaces/:id/reindex',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('workspace:update'), // OWNER/ADMIN
  controller.reindexWorkspace,
);

// ---- conversations (owner only; checked in the controller) ----

aiRoutes.get('/conversations/:id', validate({ params: idParamSchema }), controller.getConversation);
aiRoutes.patch(
  '/conversations/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: controller.renameConversationSchema }),
  controller.renameConversation,
);
aiRoutes.delete('/conversations/:id', requireVerifiedEmail, validate({ params: idParamSchema }), controller.deleteConversation);
aiRoutes.post(
  '/conversations/:id/messages',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: sendAiMessageSchema }),
  controller.sendMessage,
);

// ---- projects ----

aiRoutes.post(
  '/projects/:id/generate-tasks',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: generateTasksSchema }),
  requireWorkspacePermission('ai:generate', { from: 'project' }),
  requireProjectAccess,
  controller.generateTasks,
);
aiRoutes.post(
  '/projects/:id/commit-tasks',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: commitGeneratedTasksSchema }),
  requireWorkspacePermission('task:create', { from: 'project' }),
  requireProjectAccess,
  controller.commitTasks,
);
aiRoutes.get(
  '/projects/:id/insights',
  validate({ params: idParamSchema, query: controller.insightQuerySchema }),
  requireWorkspacePermission('ai:use', { from: 'project' }),
  requireProjectAccess,
  controller.projectInsights,
);

// ---- documents ----

aiRoutes.post(
  '/documents/:id/summarize',
  validate({ params: idParamSchema, body: summarizeSchema }),
  requireDocumentPermission('ai:use'), // plus project access, like document:view
  controller.summarizeDocument,
);
