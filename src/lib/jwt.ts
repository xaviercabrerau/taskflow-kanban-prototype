import jwt from 'jsonwebtoken';

/**
 * JWT Token Payload Structure
 * Matches the AuthToken interface from the brief
 */
export interface AuthToken {
  sub: string;        // User ID (UUID)
  role: 'admin' | 'user' | 'viewer';  // User Role
  iat: number;        // Issued at (timestamp in seconds)
  exp: number;        // Expiration (timestamp in seconds)
}

/**
 * Verify and decode a JWT token
 * Extracts the token from Authorization header and verifies it
 *
 * @param authorizationHeader - Authorization header value (e.g., "Bearer token...")
 * @returns Decoded AuthToken with role field if valid
 * @throws Error if token is invalid or missing
 */
export function verifyToken(authorizationHeader?: string): AuthToken {
  if (!authorizationHeader) {
    throw new Error('Missing authorization header');
  }

  const token = authorizationHeader.replace('Bearer ', '');
  if (!token) {
    throw new Error('Invalid authorization header format');
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable not set');
  }

  try {
    const decoded = jwt.verify(token, secret) as AuthToken;

    // Verify required fields
    if (!decoded.sub || !decoded.role) {
      throw new Error('Invalid token payload - missing required fields');
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token has expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token signature');
    }
    throw error;
  }
}

/**
 * Create a new JWT token
 *
 * @param userId - The user's ID (UUID)
 * @param role - The user's role (admin, user, or viewer)
 * @param expiresInSeconds - Token expiration time in seconds (default: 24 hours)
 * @returns Signed JWT token string
 */
export function signToken(
  userId: string,
  role: 'admin' | 'user' | 'viewer',
  expiresInSeconds: number = 24 * 60 * 60 // 24 hours default
): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable not set');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload: AuthToken = {
    sub: userId,
    role: role,
    iat: now,
    exp: now + expiresInSeconds,
  };

  return jwt.sign(payload, secret);
}

/**
 * Verify token and check if user has admin role
 * Used by API routes to protect admin endpoints
 *
 * @param authorizationHeader - Authorization header from request
 * @returns AuthToken if valid and user is admin
 * @throws Error if token is invalid, expired, or user is not admin
 */
export function verifyAdminToken(authorizationHeader?: string): AuthToken {
  const token = verifyToken(authorizationHeader);

  if (token.role !== 'admin') {
    throw new Error('User must have admin role to access this endpoint');
  }

  return token;
}
