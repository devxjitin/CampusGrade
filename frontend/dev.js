process.env.NEXT_DISABLE_SWC = '1';
process.env.__NEXT_DISABLE_MEMORY_WATCHER = '1';

const { startServer } = require('next/dist/server/lib/start-server');

console.log('Starting Next.js server with SWC disabled...');

startServer({
  dir: __dirname,
  port: 3000,
  isDev: true,
  hostname: '0.0.0.0'
}).then(() => {
  console.log('Next.js dev server is listening on http://localhost:3000');
}).catch((err) => {
  console.error('Failed to start Next.js dev server:', err);
});

setInterval(() => {}, 100000);
