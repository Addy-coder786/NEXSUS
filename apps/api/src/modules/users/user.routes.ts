import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import {
  ERROR_CODES,
  changePasswordSchema,
  idParamSchema,
  updatePreferencesSchema,
  updateProfileSchema,
} from '@nexus/shared';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/ApiError';
import * as controller from './user.controller';
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from './user.service';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if ((AVATAR_MIME_TYPES as readonly string[]).includes(file.mimetype)) return cb(null, true);
    cb(ApiError.badRequest('Only PNG, JPEG and WebP images are allowed'));
  },
});

/** Runs multer and converts its own errors into API errors (size limit, wrong field, ...). */
const avatarUpload: RequestHandler = (req, res, next) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(413, ERROR_CODES.BAD_REQUEST, 'File too large (max 2 MB)'));
      }
      return next(ApiError.badRequest(err.message));
    }
    next(err);
  });
};

export const userRoutes = Router();

userRoutes.use(authenticate);

userRoutes.get('/me', controller.getMe);
userRoutes.patch('/me', validate({ body: updateProfileSchema }), controller.updateProfile);
userRoutes.patch(
  '/me/preferences',
  validate({ body: updatePreferencesSchema }),
  controller.updatePreferences,
);
userRoutes.patch('/me/password', validate({ body: changePasswordSchema }), controller.changePassword);
userRoutes.post('/me/avatar', avatarUpload, controller.uploadAvatar);
userRoutes.delete('/me/avatar', controller.deleteAvatar);

userRoutes.get('/:id', validate({ params: idParamSchema }), controller.getPublicUser);
