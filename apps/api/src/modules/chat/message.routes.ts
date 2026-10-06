import { Router } from 'express';
import { editMessageSchema, idParamSchema, reactionSchema } from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requireMessageAccess } from './chat.access';
import * as messageController from './message.controller';

const router = Router();
router.use(authenticate);

router.get('/:id', validate({ params: idParamSchema }), requireMessageAccess(), messageController.getMessage);
router.get(
  '/:id/replies',
  validate({ params: idParamSchema, query: messageController.repliesQuerySchema }),
  requireMessageAccess(),
  messageController.listReplies,
);
router.patch(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: editMessageSchema }),
  requireMessageAccess(), // author-only enforced in the service
  messageController.editMessage,
);
router.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireMessageAccess(), // author or channel:manage enforced in the service
  messageController.deleteMessage,
);
router.post(
  '/:id/reactions',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: reactionSchema }),
  requireMessageAccess(),
  messageController.toggleReaction,
);

export const messageRoutes = router;
