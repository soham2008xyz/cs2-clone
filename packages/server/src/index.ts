import { startServer } from './app.js';

const { port } = await startServer();
console.log(`[server] http/ws listening on :${port}`);
