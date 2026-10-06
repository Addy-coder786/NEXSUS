import { Router } from 'express';
import { idParamSchema, updateCommentSchema } from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireProjectAccess, requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as commentController from './comment.controller';

const router = Router();
router.use(authenticate);

const fromComment = { from: 'comment' as const };

// Author-only / author-or-manager rules are enforced in the service; membership here.
router.patch(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: updateCommentSchema }),
  requireWorkspacePermission('member', fromComment),
  requireProjectAccess,
  commentController.updateComment,
);
router.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('member', fromComment),
  requireProjectAccess,
  commentController.deleteComment,
);

export const commentRoutes = router;
