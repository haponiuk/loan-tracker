import 'dotenv/config';
import fs from 'node:fs/promises';
import {Client} from 'pg';

const databaseUrl = process.env.SUPABASE_DATABASE_URL;

if (!databaseUrl) {
    throw new Error('Set SUPABASE_DATABASE_URL before running this script.');
}

const migrationSql = await fs.readFile(
    new URL('../supabase/migrate-bigint-ids.sql', import.meta.url),
    'utf8',
);
const client = new Client({
    connectionString: databaseUrl,
    ssl: {
        rejectUnauthorized: false,
    },
});

await client.connect();

try {
    await client.query(migrationSql);
    console.log('Supabase ids migrated to BIGINT.');
} finally {
    await client.end();
}
