import bcrypt from 'bcryptjs';
import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';
import {
  OAUTH_PROVIDERS,
  USER_AVAILABILITY,
  type NotificationPreferences,
  type OAuthProvider,
  type Theme,
  type UserAvailability,
  type UserDto,
  type UserPublicDto,
} from '@nexus/shared';

export interface IOAuthAccount {
  provider: OAuthProvider;
  providerId: string;
  email: string | null;
}

export interface IUser {
  name: string;
  email: string;
  passwordHash: string | null;
  avatarUrl: string | null;
  bio: string | null;
  title: string | null;
  timezone: string | null;
  availability: UserAvailability;
  emailVerified: boolean;
  preferences: { notifications: NotificationPreferences; theme: Theme };
  oauthAccounts: IOAuthAccount[];
  /** Incremented to invalidate every outstanding access token (logout everywhere, password change). */
  tokenVersion: number;
  passwordChangedAt: Date | null;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  comparePassword(candidate: string): Promise<boolean>;
  setPassword(plain: string): Promise<void>;
  toPublicDto(): UserPublicDto;
  toDto(): UserDto;
}

export type UserDocument = HydratedDocument<IUser, IUserMethods>;
type UserModel = Model<IUser, object, IUserMethods>;

const BCRYPT_ROUNDS = 12;

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, default: null, select: false },
    avatarUrl: { type: String, default: null },
    bio: { type: String, default: null, maxlength: 300 },
    title: { type: String, default: null, maxlength: 80 },
    timezone: { type: String, default: null },
    availability: { type: String, enum: USER_AVAILABILITY, default: 'AVAILABLE' },
    emailVerified: { type: Boolean, default: false },
    preferences: {
      notifications: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        taskAssigned: { type: Boolean, default: true },
        taskCompleted: { type: Boolean, default: true },
        mentions: { type: Boolean, default: true },
        comments: { type: Boolean, default: true },
        deadlines: { type: Boolean, default: true },
      },
      theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    },
    oauthAccounts: {
      type: [
        {
          _id: false,
          provider: { type: String, enum: OAUTH_PROVIDERS, required: true },
          providerId: { type: String, required: true },
          email: { type: String, default: null },
        },
      ],
      default: [],
    },
    tokenVersion: { type: Number, default: 0 },
    passwordChangedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

userSchema.index({ 'oauthAccounts.provider': 1, 'oauthAccounts.providerId': 1 }, { sparse: true });
userSchema.index({ name: 'text', email: 'text' });

userSchema.methods.comparePassword = async function (candidate: string) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.methods.setPassword = async function (plain: string) {
  this.passwordHash = await bcrypt.hash(plain, BCRYPT_ROUNDS);
  this.passwordChangedAt = new Date();
};

userSchema.methods.toPublicDto = function (): UserPublicDto {
  return {
    id: String(this._id),
    name: this.name,
    email: this.email,
    avatarUrl: this.avatarUrl,
    title: this.title,
    availability: this.availability,
  };
};

userSchema.methods.toDto = function (): UserDto {
  return {
    ...this.toPublicDto(),
    bio: this.bio,
    timezone: this.timezone,
    emailVerified: this.emailVerified,
    hasPassword: Boolean(this.passwordHash),
    preferences: this.preferences,
    oauthProviders: this.oauthAccounts.map((a) => a.provider),
    createdAt: this.createdAt.toISOString(),
  };
};

export const User = (mongoose.models.User as UserModel) ?? mongoose.model<IUser, UserModel>('User', userSchema);

/** Build a public DTO from a lean/populated user object (used when populating references). */
export function toUserPublicDto(u: {
  _id: unknown;
  name: string;
  email: string;
  avatarUrl?: string | null;
  title?: string | null;
  availability?: UserAvailability;
}): UserPublicDto {
  return {
    id: String(u._id),
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl ?? null,
    title: u.title ?? null,
    availability: u.availability ?? 'OFFLINE',
  };
}

/** Field list to select when populating a user reference. */
export const USER_PUBLIC_FIELDS = 'name email avatarUrl title availability';
