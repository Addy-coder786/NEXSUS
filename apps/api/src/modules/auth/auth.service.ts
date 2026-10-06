import {
  ERROR_CODES,
  REFRESH_TOKEN_REMEMBER_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  type LoginInput,
  type RegisterInput,
  type SessionDto,
} from '@nexus/shared';
import { env } from '../../config/env';
import { Session, type SessionDocument } from '../../models/Session';
import { Token, type TokenType } from '../../models/Token';
import { User, type UserDocument } from '../../models/User';
import { sendEmail } from '../../services/email';
import { ApiError } from '../../utils/ApiError';
import { randomToken, sha256 } from '../../utils/crypto';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/tokens';
import { passwordChangedEmail, passwordResetEmail, verificationEmail } from './auth.emails';

export interface RequestMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  /** Remaining lifetime of the session, used as the refresh cookie max-age. */
  refreshTtlSec: number;
}

export interface AuthResult {
  user: UserDocument;
  tokens: IssuedTokens;
}

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const INVALID_CREDENTIALS = 'Invalid email or password';
const INVALID_TOKEN = 'Invalid or expired token';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Loads a non-deleted user including passwordHash (needed for `toDto().hasPassword`). */
export async function findActiveUserById(id: string): Promise<UserDocument | null> {
  return User.findOne({ _id: id, deletedAt: null }, '+passwordHash');
}

export async function getCurrentUser(id: string): Promise<UserDocument> {
  const user = await findActiveUserById(id);
  if (!user) throw ApiError.unauthorized('Account not found');
  return user;
}

// ---------------------------------------------------------------------------
// Sessions & tokens
// ---------------------------------------------------------------------------

function remainingTtlSec(session: SessionDocument): number {
  return Math.max(1, Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000));
}

/**
 * Generates a fresh refresh id for the session and signs both tokens. Mutates the session
 * (refreshTokenHash, lastUsedAt); the caller is responsible for saving it.
 */
export function issueTokens(user: UserDocument, session: SessionDocument): IssuedTokens {
  const jti = randomToken();
  session.refreshTokenHash = sha256(jti);
  session.lastUsedAt = new Date();

  const sub = String(user._id);
  const sid = String(session._id);
  const refreshTtlSec = remainingTtlSec(session);

  return {
    accessToken: signAccessToken({ sub, sid, tv: user.tokenVersion }),
    refreshToken: signRefreshToken({ sub, sid, jti }, refreshTtlSec),
    refreshTtlSec,
  };
}

/** Creates a Session document for a login and returns the token pair. */
export async function createSession(
  user: UserDocument,
  meta: RequestMeta,
  rememberMe = false,
): Promise<IssuedTokens> {
  const ttlSec = rememberMe ? REFRESH_TOKEN_REMEMBER_TTL_SEC : REFRESH_TOKEN_TTL_SEC;
  const session = new Session({
    userId: user._id,
    refreshTokenHash: 'pending',
    userAgent: meta.userAgent,
    ip: meta.ip,
    rememberMe,
    expiresAt: new Date(Date.now() + ttlSec * 1000),
  });
  const tokens = issueTokens(user, session);
  await session.save();
  return tokens;
}

export async function refreshSession(refreshToken: string): Promise<AuthResult> {
  const payload = verifyRefreshToken(refreshToken);

  const session = await Session.findById(payload.sid);
  if (!session || String(session.userId) !== payload.sub) {
    throw ApiError.unauthorized('Session not found', ERROR_CODES.TOKEN_INVALID);
  }
  if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Session expired', ERROR_CODES.TOKEN_INVALID);
  }

  if (sha256(payload.jti) !== session.refreshTokenHash) {
    // An older refresh token was presented: it was rotated out already, so either the
    // legitimate client or an attacker is now holding a stolen copy. Kill the session.
    session.revokedAt = new Date();
    await session.save();
    throw ApiError.unauthorized('Refresh token reuse detected', ERROR_CODES.TOKEN_INVALID);
  }

  const user = await findActiveUserById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account not found', ERROR_CODES.TOKEN_INVALID);

  const tokens = issueTokens(user, session);
  await session.save();
  return { user, tokens };
}

export async function logout(sessionId: string | null): Promise<void> {
  if (!sessionId) return;
  await Session.deleteOne({ _id: sessionId });
}

export async function logoutAll(userId: string): Promise<void> {
  await Promise.all([
    User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } }),
    Session.deleteMany({ userId }),
  ]);
}

export async function listSessions(userId: string, currentSessionId: string): Promise<SessionDto[]> {
  const sessions = await Session.find({
    userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1, _id: -1 })
    .lean();

  return sessions.map((s) => ({
    id: String(s._id),
    userAgent: s.userAgent,
    ip: s.ip,
    createdAt: s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt.toISOString(),
    current: String(s._id) === currentSessionId,
  }));
}

export async function revokeSession(userId: string, sessionId: string): Promise<void> {
  const deleted = await Session.findOneAndDelete({ _id: sessionId, userId });
  if (!deleted) throw ApiError.notFound('Session');
}

// ---------------------------------------------------------------------------
// One-time tokens
// ---------------------------------------------------------------------------

async function createOneTimeToken(user: UserDocument, type: TokenType, ttlMs: number): Promise<string> {
  // Only one live token of a type per user: older links stop working.
  await Token.deleteMany({ userId: user._id, type, usedAt: null });
  const plain = randomToken();
  await Token.create({
    userId: user._id,
    type,
    tokenHash: sha256(plain),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return plain;
}

export async function sendVerificationEmail(user: UserDocument): Promise<void> {
  const token = await createOneTimeToken(user, 'EMAIL_VERIFY', EMAIL_VERIFY_TTL_MS);
  const link = `${env.CLIENT_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmail(verificationEmail(user.email, user.name, link));
}

// ---------------------------------------------------------------------------
// Register / login
// ---------------------------------------------------------------------------

export async function register(input: RegisterInput, meta: RequestMeta): Promise<AuthResult> {
  const exists = await User.exists({ email: input.email });
  if (exists) throw ApiError.conflict('An account with this email already exists');

  const user = new User({ name: input.name, email: input.email, lastLoginAt: new Date() });
  await user.setPassword(input.password);
  await user.save();

  const tokens = await createSession(user, meta, false);
  await sendVerificationEmail(user);
  return { user, tokens };
}

export async function login(input: LoginInput, meta: RequestMeta): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email, deletedAt: null }, '+passwordHash');
  // Same response for unknown email, OAuth-only account, and wrong password.
  if (!user || !user.passwordHash) throw ApiError.unauthorized(INVALID_CREDENTIALS);
  const valid = await user.comparePassword(input.password);
  if (!valid) throw ApiError.unauthorized(INVALID_CREDENTIALS);

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await createSession(user, meta, input.rememberMe);
  return { user, tokens };
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email, deletedAt: null }, '+passwordHash');
  if (!user) return; // no enumeration: the controller answers 200 either way
  const token = await createOneTimeToken(user, 'PASSWORD_RESET', PASSWORD_RESET_TTL_MS);
  const link = `${env.CLIENT_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail(passwordResetEmail(user.email, user.name, link));
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const record = await Token.findOne({
    tokenHash: sha256(token),
    type: 'PASSWORD_RESET',
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });
  const user = record ? await findActiveUserById(String(record.userId)) : null;
  if (!record || !user) throw ApiError.badRequest(INVALID_TOKEN);

  await user.setPassword(password);
  user.tokenVersion += 1;
  record.usedAt = new Date();
  await Promise.all([user.save(), record.save(), Session.deleteMany({ userId: user._id })]);
  await sendEmail(passwordChangedEmail(user.email, user.name));
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export async function verifyEmail(token: string): Promise<UserDocument> {
  const record = await Token.findOne({ tokenHash: sha256(token), type: 'EMAIL_VERIFY' });
  const user = record ? await findActiveUserById(String(record.userId)) : null;
  if (!record || !user) throw ApiError.badRequest(INVALID_TOKEN);

  // Opening the link twice should not error out once the address is confirmed.
  if (user.emailVerified) return user;

  if (record.usedAt || record.expiresAt.getTime() <= Date.now()) {
    throw ApiError.badRequest(INVALID_TOKEN);
  }

  user.emailVerified = true;
  record.usedAt = new Date();
  await Promise.all([user.save(), record.save()]);
  return user;
}

export async function resendVerification(userId: string): Promise<void> {
  const user = await getCurrentUser(userId);
  if (user.emailVerified) throw ApiError.badRequest('Email is already verified');
  await sendVerificationEmail(user);
}
