import type { Context } from 'hono';
import { RateLimitError, UpstreamError } from './google';
import type { Env } from '../types';

// Default backoff to hand consumers when Google's 429 didn't include a Retry-After —
// keeps the contract single-path: callers never need a branch for "no value given".
const DEFAULT_RETRY_AFTER = 60;

// Maps a caught error to an HTTP response with a consistent { error } body:
// RateLimitError -> 429 with Retry-After (header + body) so generic retry libraries and
// gsdb clients alike can back off without parsing the message; UpstreamError -> 502,
// since the failure is Google's, not the caller's, and is safe to retry; anything else
// (a thrown business-logic Error like "column not found") -> 400.
export function errorResponse(c: Context<Env>, err: unknown): Response {
  if (err instanceof RateLimitError) {
    const retryAfter = err.retryAfter ?? DEFAULT_RETRY_AFTER;
    c.header('Retry-After', String(retryAfter));
    return c.json({ error: err.message, retryAfter }, 429);
  }
  if (err instanceof UpstreamError) {
    return c.json({ error: err.message }, 502);
  }
  return c.json({ error: err instanceof Error ? err.message : 'Unknown error' }, 400);
}

// Wraps a handler body, converting any thrown error into the shared response shape.
export async function tryOrError<T>(c: Context<Env>, fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (err) {
    return errorResponse(c, err);
  }
}
