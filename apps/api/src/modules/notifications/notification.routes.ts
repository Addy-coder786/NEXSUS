import { Router } from 'express';
import { idParamSchema, notificationListQuerySchema } from '@nexus/shared';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import * as notificationController from './notification.controller';

const router = Router();
router.use(authenticate);

// Notifications are the caller's own data; marking them read needs no verified email.
router.get('/', validate({ query: notificationListQuerySchema }), notificationController.listNotifications);
router.get('/unread-count', notificationController.unreadCount);
router.post('/read-all', validate({ body: notificationController.readAllSchema }), notificationController.markAllRead);
router.patch('/:id/read', validate({ params: idParamSchema }), notificationController.markRead);
router.delete('/:id', validate({ params: idParamSchema }), notificationController.deleteNotification);

export const notificationRoutes = router;
