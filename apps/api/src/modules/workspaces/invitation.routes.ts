import { Router } from 'express';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as invitationController from './invitation.controller';

const router = Router();

/** Public: lets the invite page render before the invitee logs in or registers. */
router.get(
  '/:token',
  validate({ params: invitationController.tokenParamsSchema }),
  invitationController.previewInvitation,
);

router.post(
  '/:token/accept',
  authenticate,
  requireVerifiedEmail,
  validate({ params: invitationController.tokenParamsSchema }),
  invitationController.acceptInvitation,
);

export const invitationRoutes = router;
