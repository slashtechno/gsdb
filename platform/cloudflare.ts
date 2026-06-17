// Cloudflare Workers entry point.
// c.env is populated automatically by the Workers runtime from wrangler.toml bindings.
// Requires: wrangler.toml with [vars] for the string env vars.
import app from '../src/index';

export default app;
