import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import express from 'express';
import {query} from './db.js';

const app = express();
const port = Number(process.env.PORT) || 3001;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const shouldUseSupabase = Boolean(supabaseUrl);
const supabaseAdmin =
    supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, {
              auth: {
                  persistSession: false,
                  autoRefreshToken: false,
              },
          })
        : null;

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('public/uploads'));

app.post('/api/upload', async (request, response) => {
    try {
        const { fileName, fileData } = request.body || {};
        if (!fileName || !fileData) {
            return response.status(400).json({ error: 'Відсутні дані файлу.' });
        }

        const buffer = Buffer.from(fileData, 'base64');
        const fileExt = path.extname(fileName) || '.jpg';
        const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}${fileExt}`;

        const uploadDir = path.resolve('public/uploads');
        await fs.mkdir(uploadDir, { recursive: true });
        await fs.writeFile(path.join(uploadDir, uniqueName), buffer);

        response.json({ url: `/uploads/${uniqueName}` });
    } catch (error) {
        response.status(500).json({ error: error.message });
    }
});

app.get('/api/health', async (request, response) => {
    try {
        await query('SELECT 1');
        response.json({ok: true});
    } catch (error) {
        response.status(500).json({ok: false, error: error.message});
    }
});

app.get('/api/debtors', async (request, response) => {
    try {
        const [debtorsResult, loansResult, repaymentsResult] = await Promise.all([
            query(`
                SELECT id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url
                FROM debtors
                ORDER BY remaining DESC, full_name ASC
            `),
            query(`
                SELECT id, debtor_id, amount, loan_date, due_date, notes, files
                FROM loans
                ORDER BY loan_date DESC NULLS LAST, id DESC
            `),
            query(`
                SELECT id, debtor_id, amount, repayment_date
                FROM repayments
                ORDER BY repayment_date DESC NULLS LAST, id DESC
            `),
        ]);

        const loansByDebtor = groupByDebtor(loansResult.rows, row => ({
            id: row.id,
            amount: toNumber(row.amount),
            date: row.loan_date,
            dueDate: row.due_date,
            notes: row.notes || '',
            files: Array.isArray(row.files) ? row.files : [],
        }));
        const repaymentsByDebtor = groupByDebtor(repaymentsResult.rows, row => ({
            id: row.id,
            amount: toNumber(row.amount),
            date: row.repayment_date,
        }));

        response.json({
            debtors: debtorsResult.rows.map(row => ({
                id: row.id,
                name: row.full_name,
                firstName: row.first_name || '',
                lastName: row.last_name || '',
                borrowed: toNumber(row.borrowed),
                repaid: toNumber(row.repaid),
                remaining: toNumber(row.remaining),
                photoUrl: row.photo_url,
                loans: loansByDebtor.get(row.id) || [],
                repayments: repaymentsByDebtor.get(row.id) || [],
            })),
        });
    } catch (error) {
        response.status(500).json({error: error.message});
    }
});

app.post('/api/debtors', async (request, response) => {
    try {
        const input = normalizeDebtorInput(request.body || {});
        const debtor = shouldUseSupabase ? await insertSupabaseDebtor(input) : await insertLocalDebtor(input);

        response.status(201).json({debtor});
    } catch (error) {
        response.status(400).json({error: error.message});
    }
});

app.listen(port, () => {
    console.log(`Loan Tracker API listening on http://localhost:${port}`);
});

function groupByDebtor(rows, mapper) {
    return rows.reduce((map, row) => {
        const items = map.get(row.debtor_id) || [];
        items.push(mapper(row));
        map.set(row.debtor_id, items);
        return map;
    }, new Map());
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDebtorInput(input) {
    const firstName = cleanText(input.firstName);
    const lastName = cleanText(input.lastName);
    const photoUrl = cleanText(input.photoUrl);
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    if (!fullName) {
        throw new Error('Вкажи хоча б імʼя або прізвище.');
    }

    if (photoUrl && !isValidUrl(photoUrl)) {
        throw new Error('Фото URL має бути повним посиланням.');
    }

    return {
        fullName,
        firstName: firstName || null,
        lastName: lastName || null,
        photoUrl: photoUrl || null,
    };
}

async function insertSupabaseDebtor(input) {
    if (!supabaseAdmin) {
        throw new Error('Не задано SUPABASE_SERVICE_ROLE_KEY для запису в Supabase.');
    }

    const {data, error} = await supabaseAdmin
        .from('debtors')
        .insert({
            full_name: input.fullName,
            first_name: input.firstName,
            last_name: input.lastName,
            photo_url: input.photoUrl,
        })
        .select('id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url')
        .single();

    if (!error) {
        return mapDebtor(data);
    }

    if (!isMissingIdDefaultError(error)) {
        throw new Error(error.message);
    }

    const retry = await supabaseAdmin
        .from('debtors')
        .insert({
            id: await getNextSupabaseDebtorId(),
            full_name: input.fullName,
            first_name: input.firstName,
            last_name: input.lastName,
            photo_url: input.photoUrl,
        })
        .select('id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url')
        .single();

    if (retry.error) {
        throw new Error(retry.error.message);
    }

    return mapDebtor(retry.data);
}

async function insertLocalDebtor(input) {
    let result;

    try {
        result = await query(
            `
                INSERT INTO debtors (full_name, first_name, last_name, photo_url)
                VALUES ($1, $2, $3, $4)
                RETURNING id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url
            `,
            [input.fullName, input.firstName, input.lastName, input.photoUrl],
        );
    } catch (error) {
        if (!isMissingIdDefaultError(error)) {
            throw error;
        }

        result = await query(
            `
                INSERT INTO debtors (id, full_name, first_name, last_name, photo_url)
                VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM debtors), $1, $2, $3, $4)
                RETURNING id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url
            `,
            [input.fullName, input.firstName, input.lastName, input.photoUrl],
        );
    }

    return mapDebtor(result.rows[0]);
}

async function getNextSupabaseDebtorId() {
    const {data, error} = await supabaseAdmin
        .from('debtors')
        .select('id')
        .order('id', {ascending: false})
        .limit(1);

    if (error) {
        throw new Error(error.message);
    }

    return Number(data?.[0]?.id || 0) + 1;
}

function isMissingIdDefaultError(error) {
    return error?.code === '23502' && error?.message?.includes('column "id"');
}

function mapDebtor(row) {
    return {
        id: row.id,
        name: row.full_name,
        firstName: row.first_name || '',
        lastName: row.last_name || '',
        borrowed: toNumber(row.borrowed),
        repaid: toNumber(row.repaid),
        remaining: toNumber(row.remaining),
        photoUrl: row.photo_url,
        loans: [],
        repayments: [],
    };
}

function cleanText(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function isValidUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}
