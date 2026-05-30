import 'dotenv/config';
import pg from 'pg';

const {Pool} = pg;

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function query(sql, params = []) {
    return pool.query(sql, params);
}

export async function closePool() {
    await pool.end();
}
