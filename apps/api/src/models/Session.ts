import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

/**
 * One document per login (device). Holds the hash of the *current* refresh token.
 * Rotation: each /refresh replaces refreshTokenHash. Presenting an old hash = reuse → revoke session.
 */
export interface ISession {
  userId: Types.ObjectId;
  refreshTokenHash: string;
  userAgent: string | null;
  ip: string | null;
  rememberMe: boolean;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionDocument = HydratedDocument<ISession>;

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, index: true },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    rememberMe: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: () => new Date() },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Mongo removes the document once expiresAt passes.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session =
  (mongoose.models.Session as Model<ISession>) ?? mongoose.model<ISession>('Session', sessionSchema);
