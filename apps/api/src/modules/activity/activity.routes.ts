import { Router } from 'express';
import { paginationQuerySchema } from '@nexus/shared';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { getMyActivities } from './activity.controller';

export const activityRoutes = Router();

activityRoutes.use(authenticate);

/** GET /activities/me — feed across every workspace the caller belongs to. */
activityRoutes.get('/me', validate({ query: paginationQuerySchema }), getMyActivities);
