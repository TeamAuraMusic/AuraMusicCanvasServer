// Cloudflare Workers entry point. nodejs_compat provides Express's node:http
// server, process.env (including secrets) and Buffer. httpServerHandler bridges
// incoming Worker requests to the Express listener.
import { httpServerHandler } from 'cloudflare:node';
import app from './app.js';

const PORT = Number(process.env.PORT) || 3000;
let handler;

app.listen(PORT);
handler = httpServerHandler({ port: PORT });

export default {
  async fetch(request, env, ctx) {
    // Expose bindings to the Express app (KV, secrets, etc.)
    globalThis.__ENV = env;
    if (env.CANVAS_CACHE) globalThis.CANVAS_CACHE = env.CANVAS_CACHE;
    if (env.SP_DC) process.env.SP_DC = env.SP_DC;
    return handler(request, env, ctx);
  },
};
