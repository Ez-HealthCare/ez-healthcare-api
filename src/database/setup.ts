import dataSource from './data-source';

await dataSource.initialize();
await dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
await dataSource.runMigrations();
await dataSource.destroy();
