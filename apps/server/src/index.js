import { startServer } from './app.js';

const { port, host } = await startServer();
console.log(`ReelReady listening at http://${host}:${port}`);

const shutdown = () => process.exit(0);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
