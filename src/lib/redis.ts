/**
 * Redis connection for BullMQ and other background services.
 * Uses Vercel KV for Redis backend.
 */

import { createClient } from '@vercel/kv';

let redisClient: ReturnType<typeof createClient> | null = null;

/**
 * Get or create the shared Redis client for BullMQ and other services.
 * Uses environment variables:
 * - KV_URL: Redis connection URL
 * - KV_REST_API_URL: Vercel KV REST endpoint
 * - KV_REST_API_TOKEN: Vercel KV authentication token
 */
export function getRedisClient() {
  if (!redisClient) {
    redisClient = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return redisClient;
}

/**
 * Exported Redis client instance for BullMQ.
 * BullMQ can use the Vercel KV client as it implements the Redis client interface.
 */
export const redis = getRedisClient();
