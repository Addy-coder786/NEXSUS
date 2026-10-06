import { Router } from 'express';
import {
  createCommentSchema,
  idParamSchema,
  moveTaskSchema,
  paginationQuerySchema,
  updateTaskSchema,
} from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireProjectAccess, requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { taskFileRoutes } from '../files/file.routes';
import * as taskController from './task.controller';

const router = Router();
router.use(authenticate);

const fromTask = { from: 'task' as const };

router.get(
  '/:id',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('task:view', fromTask),
  requireProjectAccess,
  taskController.getTask,
);
router.patch(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: updateTaskSchema }),
  requireWorkspacePermission('task:update', fromTask),
  requireProjectAccess,
  taskController.updateTask,
);
router.patch(
  '/:id/move',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: moveTaskSchema }),
  requireWorkspacePermission('task:update', fromTask),
  requireProjectAccess,
  taskController.moveTask,
);
router.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('task:delete', fromTask), // creator/assignee/MANAGER+ enforced in the service
  requireProjectAccess,
  taskController.deleteTask,
);
router.get(
  '/:id/subtasks',
  validate({ params: idParamSchema }),
  requireWorkspacePermission('task:view', fromTask),
  requireProjectAccess,
  taskController.listSubtasks,
);

// ---- /tasks/:id/comments ----

const comments = Router({ mergeParams: true });
comments.get(
  '/',
  validate({ params: idParamSchema, query: paginationQuerySchema }),
  requireWorkspacePermission('task:view', fromTask),
  requireProjectAccess,
  taskController.listComments,
);
comments.post(
  '/',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: createCommentSchema }),
  requireWorkspacePermission('comment:create', fromTask),
  requireProjectAccess,
  taskController.createComment,
);
router.use('/:id/comments', comments);

// ---- /tasks/:id/files ----

router.use('/:id', taskFileRoutes);

export const taskRoutes = router;
