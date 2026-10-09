// Cloudflare Workers entry point. nodejs_compat (default since compatibility
// date 2026-08-04) provides Express's node:http server, process.env (including
// the SP_DC secret) and Buffer, so app.js runs here unchanged. httpServerHandler
// bridges incoming Worker requests to the Express listener on PORT.
import { httpServerHandler } from 'cloudflare:node';
import app from './app.js';

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT);
export default httpServerHandler({ port: PORT });
