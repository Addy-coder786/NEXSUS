import { z } from 'zod';
import { USER_AVAILABILITY, type UserAvailability } from '../constants';

export const notificationPreferencesSchema = z.object({
  email: z.boolean().default(true),
  inApp: z.boolean().default(true),
  taskAssigned: z.boolean().default(true),
  taskCompleted: z.boolean().default(true),
  mentions: z.boolean().default(true),
  comments: z.boolean().default(true),
  deadlines: z.boolean().default(true),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  bio: z.string().trim().max(300).optional(),
  title: z.string().trim().max(80).optional(),
  timezone: z.string().max(60).optional(),
  availability: z.enum(USER_AVAILABILITY).optional(),
});

export const updatePreferencesSchema = z.object({
  notifications: notificationPreferencesSchema.partial().optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type Theme = 'light' | 'dark' | 'system';

export interface UserPublicDto {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  title: string | null;
  availability: UserAvailability;
}

export interface UserDto extends UserPublicDto {
  bio: string | null;
  timezone: string | null;
  emailVerified: boolean;
  hasPassword: boolean;
  preferences: { notifications: NotificationPreferences; theme: Theme };
  oauthProviders: string[];
  createdAt: string;
}
