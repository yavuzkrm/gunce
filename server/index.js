const { openDb } = require('./db');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const db = openDb(process.env.DB_FILE);
const app = createApp(db, { secureCookies: process.env.NODE_ENV === 'production' });

const server = app.listen(port, () => {
  console.log(`Günce is running on http://localhost:${port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
