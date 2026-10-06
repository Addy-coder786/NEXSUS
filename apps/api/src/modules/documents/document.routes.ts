import { Router } from 'express';
import { createDocumentSchema, documentListQuerySchema, idParamSchema, updateDocumentSchema } from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as controller from './document.controller';

// ---- /documents/:id ----

const router = Router();
router.use(authenticate);

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  controller.requireDocumentPermission('document:view'),
  controller.getDocument,
);
router.patch(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: updateDocumentSchema }),
  controller.requireDocumentPermission('document:update'),
  controller.updateDocument,
);
router.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  controller.requireDocumentPermission('document:view'), // document:delete or creator: enforced in the service
  controller.deleteDocument,
);
router.get(
  '/:id/versions',
  validate({ params: idParamSchema }),
  controller.requireDocumentPermission('document:view'),
  controller.listVersions,
);
router.get(
  '/:id/versions/:version',
  validate({ params: controller.versionParamsSchema }),
  controller.requireDocumentPermission('document:view'),
  controller.getVersion,
);
router.post(
  '/:id/versions/:version/restore',
  requireVerifiedEmail,
  validate({ params: controller.versionParamsSchema }),
  controller.requireDocumentPermission('document:update'),
  controller.restoreVersion,
);
router.post(
  '/:id/duplicate',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  controller.requireDocumentPermission('document:create'),
  controller.duplicateDocument,
);

export const documentRoutes = router;

// ---- /workspaces/:id/documents (mounted by workspace.routes with `/:id`) ----

// authenticate is applied per route so unrelated /workspaces/:id/* requests are not re-authenticated.
const workspaceRouter = Router({ mergeParams: true });

workspaceRouter.get(
  '/documents',
  authenticate,
  validate({ params: idParamSchema, query: documentListQuerySchema }),
  requireWorkspacePermission('document:view'),
  controller.listDocuments,
);
workspaceRouter.post(
  '/documents',
  authenticate,
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: createDocumentSchema }),
  requireWorkspacePermission('document:create'),
  controller.createDocument,
);

export const workspaceDocumentRoutes = workspaceRouter;
