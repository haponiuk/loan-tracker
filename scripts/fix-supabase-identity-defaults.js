import 'dotenv/config';
import fs from 'node:fs/promises';
import {Client} from 'pg';

const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error('Set SUPABASE_DATABASE_URL or DATABASE_URL before running this script.');
}

const migrationSql = await fs.readFile(
    new URL('../supabase/fix-identity-defaults.sql', import.meta.url),
    'utf8',
);
const client = new Client({
    connectionString: databaseUrl,
    ssl: shouldUseSsl(databaseUrl) ? {rejectUnauthorized: false} : undefined,
});

await client.connect();

try {
    await client.query(migrationSql);
    console.log('Supabase identity defaults are ready.');
} finally {
    await client.end();
}

function shouldUseSsl(connectionString) {
    return connectionString.includes('supabase.com') || connectionString.includes('sslmode=require');
}
