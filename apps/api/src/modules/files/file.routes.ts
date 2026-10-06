import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { ERROR_CODES, MAX_FILE_SIZE_BYTES, fileListQuerySchema, idParamSchema, updateFileSchema } from '@nexus/shared';
import { authenticate, requireVerifiedEmail } from '../../middleware/authenticate';
import { requireProjectAccess, requireWorkspacePermission } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import * as controller from './file.controller';
import { isAllowedMime } from './file.validation';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMime(file.mimetype.toLowerCase())) return cb(null, true);
    cb(ApiError.badRequest(`File type ${file.mimetype} is not allowed`));
  },
});

/** Runs multer and converts its own errors into API errors (413 on size limit). */
const fileUpload: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(413, ERROR_CODES.BAD_REQUEST, 'File too large'));
      }
      return next(ApiError.badRequest(err.message));
    }
    next(err);
  });
};

// ---- /files/:id ----

const router = Router();
router.use(authenticate);

router.get('/:id', validate({ params: idParamSchema }), controller.requireFilePermission('file:view'), controller.getFile);
router.patch(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema, body: updateFileSchema }),
  controller.requireFilePermission('file:view'), // uploader or file:delete: enforced in the service
  controller.renameFile,
);
router.delete(
  '/:id',
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  controller.requireFilePermission('file:view'), // uploader or file:delete: enforced in the service
  controller.deleteFile,
);

export const fileRoutes = router;

// ---- /workspaces/:id/files (mounted by workspace.routes with `/:id`) ----

const workspaceRouter = Router({ mergeParams: true });

workspaceRouter.post(
  '/files',
  authenticate,
  requireVerifiedEmail,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('file:upload'),
  fileUpload,
  controller.uploadFile,
);
workspaceRouter.get(
  '/files',
  authenticate,
  validate({ params: idParamSchema, query: fileListQuerySchema }),
  requireWorkspacePermission('file:view'),
  controller.listFiles,
);
workspaceRouter.get(
  '/files/usage',
  authenticate,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('member'),
  controller.getUsage,
);

export const workspaceFileRoutes = workspaceRouter;

// ---- /tasks/:id/files (mounted by task.routes with `/:id`) ----

const taskRouter = Router({ mergeParams: true });

taskRouter.get(
  '/files',
  authenticate,
  validate({ params: idParamSchema }),
  requireWorkspacePermission('task:view', { from: 'task' }),
  requireProjectAccess,
  controller.listTaskFiles,
);

export const taskFileRoutes = taskRouter;
