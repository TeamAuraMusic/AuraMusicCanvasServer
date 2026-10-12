// Cloudflare Workers entry point. nodejs_compat provides Express's node:http
// server, process.env (including secrets) and Buffer. httpServerHandler bridges
// incoming Worker requests to the Express listener on PORT.
import { httpServerHandler } from 'cloudflare:node';
import app from './app.js';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT);

// httpServerHandler has shipped both as a bare fetch function and as an object
// exposing one, so resolve it instead of assuming a shape: calling it as a
// function when it is an object threw "handler is not a function" on every
// request, which took the whole Worker down with a 1101.
const bridge = httpServerHandler({ port: PORT });
const handleRequest =
  typeof bridge === 'function'
    ? bridge
    : (request, env, ctx) => bridge.fetch(request, env, ctx);

export default {
  async fetch(request, env, ctx) {
    // The Express app reads its bindings through these globals instead of taking
    // them as arguments, so they are published per request - the module graph
    // (and anything it captures at import time) is built before the first fetch
    // arrives.
    globalThis.__ENV = env;
    globalThis.CANVAS_CACHE = env?.CANVAS_CACHE;
    if (env?.SP_DC) process.env.SP_DC = env.SP_DC;
    return handleRequest(request, env, ctx);
  },
};