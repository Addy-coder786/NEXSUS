import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

export const TOKEN_TYPES = ['EMAIL_VERIFY', 'PASSWORD_RESET'] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

/**
 * One-time tokens sent by email. Only the sha256 of the plaintext is stored; the plaintext lives
 * solely in the link we email. A token is valid while `usedAt` is null and `expiresAt` is in the
 * future. Mongo's TTL monitor removes expired documents.
 */
export interface IToken {
  userId: Types.ObjectId;
  type: TokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type TokenDocument = HydratedDocument<IToken>;

const tokenSchema = new Schema<IToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: TOKEN_TYPES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

tokenSchema.index({ userId: 1, type: 1 });
tokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Token =
  (mongoose.models.Token as Model<IToken>) ?? mongoose.model<IToken>('Token', tokenSchema);
