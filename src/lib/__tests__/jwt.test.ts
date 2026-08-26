import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { signToken, verifyToken, verifyAdminToken, AuthToken } from '../jwt';
import jwt from 'jsonwebtoken';

describe('JWT Utilities', () => {
  const testSecret = 'test-secret-key-for-testing';
  const testUserId = 'user-123-abc-def';
  const testExpiration = 24 * 60 * 60; // 24 hours in seconds

  beforeEach(() => {
    process.env.JWT_SECRET = testSecret;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  describe('signToken', () => {
    it('should sign a token with correct payload for admin user', () => {
      const token = signToken(testUserId, 'admin', testExpiration);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      const decoded = jwt.verify(token, testSecret) as AuthToken;
      expect(decoded.sub).toBe(testUserId);
      expect(decoded.role).toBe('admin');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should sign a token with correct payload for user role', () => {
      const token = signToken(testUserId, 'user', testExpiration);

      const decoded = jwt.verify(token, testSecret) as AuthToken;
      expect(decoded.role).toBe('user');
    });

    it('should sign a token with correct payload for viewer role', () => {
      const token = signToken(testUserId, 'viewer', testExpiration);

      const decoded = jwt.verify(token, testSecret) as AuthToken;
      expect(decoded.role).toBe('viewer');
    });

    it('should use default expiration of 24 hours', () => {
      const token = signToken(testUserId, 'user');
      const decoded = jwt.verify(token, testSecret) as AuthToken;

      const expectedExpiration = 24 * 60 * 60;

      // Allow 1 second variance
      expect(decoded.exp - decoded.iat).toBeCloseTo(expectedExpiration, -1);
    });

    it('should throw error if JWT_SECRET is missing', () => {
      delete process.env.JWT_SECRET;

      expect(() => signToken(testUserId, 'admin')).toThrow('JWT_SECRET environment variable not set');
    });

    it('should include iat timestamp', () => {
      const token = signToken(testUserId, 'admin', testExpiration);
      const decoded = jwt.verify(token, testSecret) as AuthToken;

      const now = Math.floor(Date.now() / 1000);
      expect(decoded.iat).toBeLessThanOrEqual(now);
      expect(decoded.iat).toBeGreaterThanOrEqual(now - 2);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', () => {
      const token = signToken(testUserId, 'admin', testExpiration);
      const authHeader = `Bearer ${token}`;

      const decoded = verifyToken(authHeader);

      expect(decoded.sub).toBe(testUserId);
      expect(decoded.role).toBe('admin');
    });

    it('should throw error if authorization header is missing', () => {
      expect(() => verifyToken(undefined)).toThrow('Missing authorization header');
    });

    it('should throw error if token format is invalid', () => {
      const authHeader = 'InvalidFormat token123';

      expect(() => verifyToken(authHeader)).toThrow('Invalid token signature');
    });

    it('should throw error if token is empty', () => {
      const authHeader = 'Bearer ';

      expect(() => verifyToken(authHeader)).toThrow();
    });

    it('should throw error if token is expired', () => {
      const token = signToken(testUserId, 'admin', -10); // Expired 10 seconds ago

      const authHeader = `Bearer ${token}`;

      expect(() => verifyToken(authHeader)).toThrow('Token has expired');
    });

    it('should throw error if token signature is invalid', () => {
      const token = signToken(testUserId, 'admin', testExpiration);
      const tamperedToken = token.slice(0, -5) + 'XXXXX'; // Tamper with signature

      const authHeader = `Bearer ${tamperedToken}`;

      expect(() => verifyToken(authHeader)).toThrow('Invalid token signature');
    });

    it('should throw error if JWT_SECRET is missing', () => {
      delete process.env.JWT_SECRET;

      const token = jwt.sign(
        { sub: testUserId, role: 'admin', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + testExpiration },
        testSecret
      );

      expect(() => verifyToken(`Bearer ${token}`)).toThrow('JWT_SECRET environment variable not set');
    });

    it('should return token with all required fields', () => {
      const token = signToken(testUserId, 'admin', testExpiration);
      const authHeader = `Bearer ${token}`;

      const decoded = verifyToken(authHeader);

      expect(decoded).toHaveProperty('sub');
      expect(decoded).toHaveProperty('role');
      expect(decoded).toHaveProperty('iat');
      expect(decoded).toHaveProperty('exp');
    });

    it('should extract token correctly from Bearer prefix', () => {
      const token = signToken(testUserId, 'user', testExpiration);

      const decoded = verifyToken(`Bearer ${token}`);

      expect(decoded.sub).toBe(testUserId);
      expect(decoded.role).toBe('user');
    });
  });

  describe('verifyAdminToken', () => {
    it('should verify and return admin token', () => {
      const token = signToken(testUserId, 'admin', testExpiration);
      const authHeader = `Bearer ${token}`;

      const decoded = verifyAdminToken(authHeader);

      expect(decoded.sub).toBe(testUserId);
      expect(decoded.role).toBe('admin');
    });

    it('should throw error if user is not admin', () => {
      const token = signToken(testUserId, 'user', testExpiration);
      const authHeader = `Bearer ${token}`;

      expect(() => verifyAdminToken(authHeader)).toThrow('User must have admin role to access this endpoint');
    });

    it('should throw error if user is viewer', () => {
      const token = signToken(testUserId, 'viewer', testExpiration);
      const authHeader = `Bearer ${token}`;

      expect(() => verifyAdminToken(authHeader)).toThrow('User must have admin role to access this endpoint');
    });

    it('should throw error if token is invalid', () => {
      expect(() => verifyAdminToken('Bearer invalid.token.here')).toThrow();
    });

    it('should throw error if token is missing', () => {
      expect(() => verifyAdminToken(undefined)).toThrow();
    });
  });
});
