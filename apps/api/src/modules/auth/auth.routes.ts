import { Router } from 'express';
import { z } from 'zod';
import {
  forgotPasswordSchema,
  idParamSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@nexus/shared';
import { authenticate, optionalAuth } from '../../middleware/authenticate';
import { authLimiter, emailLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import * as controller from './auth.controller';

const oauthStartQuerySchema = z.object({ redirect: z.string().max(2000).optional() });

export const authRoutes = Router();

// Credentials
authRoutes.post('/register', authLimiter, validate({ body: registerSchema }), controller.register);
authRoutes.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);
authRoutes.post('/logout', optionalAuth, controller.logout);
authRoutes.post('/logout-all', authenticate, controller.logoutAll);
authRoutes.post('/refresh', controller.refresh);
authRoutes.get('/me', authenticate, controller.me);

// Password reset
authRoutes.post(
  '/forgot-password',
  emailLimiter,
  validate({ body: forgotPasswordSchema }),
  controller.forgotPassword,
);
authRoutes.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  controller.resetPassword,
);

// Email verification
authRoutes.post('/verify-email', validate({ body: verifyEmailSchema }), controller.verifyEmail);
authRoutes.post('/resend-verification', authenticate, emailLimiter, controller.resendVerification);

// Sessions
authRoutes.get('/sessions', authenticate, controller.listSessions);
authRoutes.delete('/sessions/:id', authenticate, validate({ params: idParamSchema }), controller.deleteSession);

// OAuth
authRoutes.get('/providers', controller.providers);
authRoutes.get('/google', validate({ query: oauthStartQuerySchema }), controller.startOAuth('google'));
// Callbacks are browser redirects: any problem ends in a redirect to the login page, never a 4xx.
authRoutes.get('/google/callback', controller.oauthCallback('google'));
authRoutes.get('/slack', validate({ query: oauthStartQuerySchema }), controller.startOAuth('slack'));
authRoutes.get('/slack/callback', controller.oauthCallback('slack'));
