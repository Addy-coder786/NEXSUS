/* eslint-disable */
/**
 * Runs a real local MongoDB using the binary that mongodb-memory-server already downloads for
 * tests, with data persisted under apps/api/.mongo-data. Useful on machines without Docker or a
 * MongoDB install. Stop with Ctrl+C. Switch to Atlas any time by changing MONGODB_URI.
 */
const path = require('node:path');
const fs = require('node:fs');
const { MongoMemoryServer } = require('mongodb-memory-server');

const port = Number(process.env.LOCAL_MONGO_PORT || 27017);
const dbPath = path.resolve(__dirname, '..', '.mongo-data');
fs.mkdirSync(dbPath, { recursive: true });

(async () => {
  const mongod = await MongoMemoryServer.create({
    instance: { port, dbPath, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
  });
  console.log(`Local MongoDB running at ${mongod.getUri()} (data: ${dbPath})`);
  console.log('Set MONGODB_URI=mongodb://127.0.0.1:' + port + '/nexus');
  const stop = async () => {
    await mongod.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
