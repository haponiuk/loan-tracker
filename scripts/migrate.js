import fs from 'node:fs/promises';
import {closePool, query} from '../server/db.js';

const schema = await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');

try {
    await query(schema);
    console.log('Database schema is ready.');
} finally {
    await closePool();
}
