import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {query, pool} from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_PHOTO_BUCKET || 'debtor-photos';

if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});

const [debtorsResult, loansResult, repaymentsResult] = await Promise.all([
    query(`
        SELECT id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url
        FROM debtors
        ORDER BY full_name ASC
    `),
    query(`
        SELECT id, debtor_id, amount, loan_date, due_date, notes, files
        FROM loans
        ORDER BY loan_date ASC NULLS LAST, id ASC
    `),
    query(`
        SELECT id, debtor_id, amount, repayment_date
        FROM repayments
        ORDER BY repayment_date ASC NULLS LAST, id ASC
    `),
]);

await ensurePhotoBucket();

const debtors = [];
for (const row of debtorsResult.rows) {
    debtors.push({
        legacyId: row.id,
        full_name: row.full_name,
        first_name: row.first_name,
        last_name: row.last_name,
        borrowed: toNumber(row.borrowed),
        repaid: toNumber(row.repaid),
        remaining: toNumber(row.remaining),
        photo_url: await uploadPhoto(row),
    });
}

const loans = loansResult.rows.map(row => ({
    legacyDebtorId: row.debtor_id,
    amount: toNumber(row.amount),
    loan_date: row.loan_date,
    due_date: row.due_date,
    notes: row.notes,
    files: Array.isArray(row.files) ? row.files : [],
}));

const repayments = repaymentsResult.rows.map(row => ({
    legacyDebtorId: row.debtor_id,
    amount: toNumber(row.amount),
    repayment_date: row.repayment_date,
}));

await clearTable('repayments');
await clearTable('loans');
await clearTable('debtors');

const debtorIdMap = await insertDebtors(debtors);
await insertRows(
    'loans',
    loans
        .map(row => ({
            debtor_id: debtorIdMap.get(String(row.legacyDebtorId)),
            amount: row.amount,
            loan_date: row.loan_date,
            due_date: row.due_date,
            notes: row.notes,
            files: row.files,
        }))
        .filter(row => row.debtor_id),
);
await insertRows(
    'repayments',
    repayments
        .map(row => ({
            debtor_id: debtorIdMap.get(String(row.legacyDebtorId)),
            amount: row.amount,
            repayment_date: row.repayment_date,
        }))
        .filter(row => row.debtor_id),
);

await pool.end();

console.log(`Seeded Supabase: ${debtors.length} debtors, ${loans.length} loans, ${repayments.length} repayments.`);

async function clearTable(tableName) {
    const {error} = await supabase.from(tableName).delete().gte('id', 0);
    if (error) {
        throw new Error(`Failed to clear ${tableName}: ${error.message}`);
    }
}

async function insertDebtors(rows) {
    const debtorIdMap = new Map();

    for (const {legacyId, ...row} of rows) {
        const {data, error} = await supabase.from('debtors').insert(row).select('id').single();
        if (error) {
            throw new Error(`Failed to seed debtors: ${error.message}`);
        }
        debtorIdMap.set(String(legacyId), data.id);
    }

    return debtorIdMap;
}

async function insertRows(tableName, rows) {
    if (rows.length === 0) {
        return;
    }

    const {error} = await supabase.from(tableName).insert(rows);
    if (error) {
        throw new Error(`Failed to seed ${tableName}: ${error.message}`);
    }
}

async function ensurePhotoBucket() {
    const {error} = await supabase.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: 1024 * 1024 * 10,
    });

    if (error && error.message !== 'The resource already exists') {
        throw new Error(`Failed to create ${bucketName} bucket: ${error.message}`);
    }
}

async function uploadPhoto(row) {
    if (!row.photo_url || /^https?:\/\//i.test(row.photo_url)) {
        return row.photo_url;
    }

    const normalizedPhotoPath = row.photo_url.startsWith('/uploads/')
        ? path.join('public', row.photo_url)
        : row.photo_url;
    const localPath = path.join(projectRoot, normalizedPhotoPath.replace(/^\/+/, ''));

    try {
        const bytes = await fs.readFile(localPath);
        const extension = path.extname(localPath) || '.jpg';
        const objectPath = `${row.id}${extension}`.replace(/[^a-zA-Z0-9._/-]/g, '_');
        const {error} = await supabase.storage.from(bucketName).upload(objectPath, bytes, {
            cacheControl: '31536000',
            contentType: contentType(extension),
            upsert: true,
        });

        if (error) {
            throw error;
        }

        const {data} = supabase.storage.from(bucketName).getPublicUrl(objectPath);
        return data.publicUrl;
    } catch (error) {
        console.warn(`Skipped photo for ${row.full_name}: ${error.message}`);
        return null;
    }
}

function contentType(extension) {
    if (extension === '.png') {
        return 'image/png';
    }
    if (extension === '.webp') {
        return 'image/webp';
    }
    return 'image/jpeg';
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
