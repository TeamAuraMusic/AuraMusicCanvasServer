// Node entry point (Render, Docker, plain `npm start`). The Express app itself
// lives in app.js; the Cloudflare Workers entry is worker.js.
import 'dotenv/config';
import app from './app.js';

const PORT = process.env.PORT || 3000;

// Never let a single bad request take the whole service down: on a free dyno a
// crash fails the Render health check and aborts the deploy with SIGTERM.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.message || err);
});

const server = app.listen(PORT, () => {
  console.log('Listening on PORT:', PORT);
});

server.on('error', (err) => {
  console.error('[server error]', err?.message || err);
  process.exit(1);
});
