import 'dotenv/config';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createClient} from '@supabase/supabase-js';
import express from 'express';
import {query} from './db.js';

const app = express();
const port = Number(process.env.PORT) || 3001;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const photoBucketName = process.env.SUPABASE_PHOTO_BUCKET || 'debtor-photos';
const loanFileBucketName = process.env.SUPABASE_LOAN_FILE_BUCKET || 'loan-files';
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
let photoBucketReady = false;
let loanFileBucketReady = false;

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static('public/uploads'));

app.post('/api/upload', async (request, response) => {
    try {
        if (shouldUseSupabase) {
            const upload = await createSupabasePhotoUpload(request.body || {});
            response.status(201).json(upload);
            return;
        }

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

app.post('/api/loan-files/upload', async (request, response) => {
    try {
        if (shouldUseSupabase) {
            const upload = await createSupabaseLoanFileUpload(request.body || {});
            response.status(201).json(upload);
            return;
        }

        const {fileName, fileData} = request.body || {};
        if (!fileName || !fileData) {
            return response.status(400).json({error: 'Відсутні дані файлу.'});
        }

        const buffer = Buffer.from(fileData, 'base64');
        const fileExt = path.extname(fileName) || '.bin';
        const uniqueName = `${Date.now()}_${randomUUID()}${fileExt}`;
        const uploadDir = path.resolve('public/uploads/loan-files');

        await fs.mkdir(uploadDir, {recursive: true});
        await fs.writeFile(path.join(uploadDir, uniqueName), buffer);

        response.status(201).json({
            file: {
                name: fileName,
                type: cleanText(request.body.contentType) || 'application/octet-stream',
                size: Number(request.body.size) || buffer.length,
                url: `/uploads/loan-files/${uniqueName}`,
                path: `loan-files/${uniqueName}`,
            },
        });
    } catch (error) {
        response.status(500).json({error: error.message});
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

app.post('/api/debtors/:debtorId/loans', async (request, response) => {
    try {
        const input = normalizeLoanInput(request.params.debtorId, request.body || {});
        const debtor = shouldUseSupabase ? await insertSupabaseLoan(input) : await insertLocalLoan(input);

        response.status(201).json({debtor});
    } catch (error) {
        response.status(400).json({error: error.message});
    }
});

app.post('/api/debtors/:debtorId/repayments', async (request, response) => {
    try {
        const input = normalizeRepaymentInput(request.params.debtorId, request.body || {});
        const debtor = shouldUseSupabase ? await insertSupabaseRepayment(input) : await insertLocalRepayment(input);

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

function normalizeLoanInput(debtorIdValue, input) {
    const debtorId = normalizeId(debtorIdValue);
    const amount = normalizeAmount(input.amount);
    const date = normalizeDate(input.date, 'Вкажи дату позики.');
    const dueDate = normalizeOptionalDate(input.dueDate);
    const notes = cleanText(input.notes);
    const files = normalizeFileInput(input.files);

    return {
        debtorId,
        amount,
        date,
        dueDate,
        notes: notes || null,
        files,
    };
}

function normalizeRepaymentInput(debtorIdValue, input) {
    return {
        debtorId: normalizeId(debtorIdValue),
        amount: normalizeAmount(input.amount),
        date: normalizeDate(input.date, 'Вкажи дату повернення.'),
    };
}

function normalizeId(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('Некоректний ID боржника.');
    }

    return parsed;
}

function normalizeAmount(value) {
    const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
    const amount = Number(normalized);

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Сума має бути більшою за 0.');
    }

    return Math.round(amount * 100) / 100;
}

function normalizeDate(value, errorMessage) {
    const date = cleanText(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(errorMessage);
    }

    return date;
}

function normalizeOptionalDate(value) {
    const date = cleanText(value);
    return date ? normalizeDate(date, 'Некоректна дата повернення позики.') : null;
}

function normalizeFileInput(files) {
    if (!Array.isArray(files)) {
        return [];
    }

    return files
        .map(file => ({
            name: cleanText(file?.name) || 'Документ',
            type: cleanText(file?.type) || 'application/octet-stream',
            size: Number(file?.size) || 0,
            url: cleanText(file?.url),
            path: cleanText(file?.path),
        }))
        .filter(file => file.url);
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

async function insertSupabaseLoan(input) {
    if (!supabaseAdmin) {
        throw new Error('Не задано SUPABASE_SERVICE_ROLE_KEY для запису в Supabase.');
    }

    const insertPayload = {
        debtor_id: input.debtorId,
        amount: input.amount,
        loan_date: input.date,
        due_date: input.dueDate,
        notes: input.notes,
        files: input.files,
    };
    const {error} = await supabaseAdmin.from('loans').insert(insertPayload);

    if (error && !isMissingIdDefaultError(error)) {
        throw new Error(error.message);
    }

    if (error) {
        const retry = await supabaseAdmin
            .from('loans')
            .insert({
                id: await getNextSupabaseRecordId('loans'),
                ...insertPayload,
            });
        if (retry.error) {
            throw new Error(retry.error.message);
        }
    }

    await updateSupabaseDebtorTotals(input.debtorId);
    return getSupabaseDebtorSnapshot(input.debtorId);
}

async function insertSupabaseRepayment(input) {
    if (!supabaseAdmin) {
        throw new Error('Не задано SUPABASE_SERVICE_ROLE_KEY для запису в Supabase.');
    }

    const insertPayload = {
        debtor_id: input.debtorId,
        amount: input.amount,
        repayment_date: input.date,
    };
    const {error} = await supabaseAdmin.from('repayments').insert(insertPayload);

    if (error && !isMissingIdDefaultError(error)) {
        throw new Error(error.message);
    }

    if (error) {
        const retry = await supabaseAdmin
            .from('repayments')
            .insert({
                id: await getNextSupabaseRecordId('repayments'),
                ...insertPayload,
            });
        if (retry.error) {
            throw new Error(retry.error.message);
        }
    }

    await updateSupabaseDebtorTotals(input.debtorId);
    return getSupabaseDebtorSnapshot(input.debtorId);
}

async function insertLocalLoan(input) {
    try {
        await query(
            `
                INSERT INTO loans (debtor_id, amount, loan_date, due_date, notes, files)
                VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [input.debtorId, input.amount, input.date, input.dueDate, input.notes, JSON.stringify(input.files)],
        );
    } catch (error) {
        if (!isMissingIdDefaultError(error)) {
            throw error;
        }

        await query(
            `
                INSERT INTO loans (id, debtor_id, amount, loan_date, due_date, notes, files)
                VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM loans), $1, $2, $3, $4, $5, $6)
            `,
            [input.debtorId, input.amount, input.date, input.dueDate, input.notes, JSON.stringify(input.files)],
        );
    }

    await updateLocalDebtorTotals(input.debtorId);
    return getLocalDebtorSnapshot(input.debtorId);
}

async function insertLocalRepayment(input) {
    try {
        await query(
            `
                INSERT INTO repayments (debtor_id, amount, repayment_date)
                VALUES ($1, $2, $3)
            `,
            [input.debtorId, input.amount, input.date],
        );
    } catch (error) {
        if (!isMissingIdDefaultError(error)) {
            throw error;
        }

        await query(
            `
                INSERT INTO repayments (id, debtor_id, amount, repayment_date)
                VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM repayments), $1, $2, $3)
            `,
            [input.debtorId, input.amount, input.date],
        );
    }

    await updateLocalDebtorTotals(input.debtorId);
    return getLocalDebtorSnapshot(input.debtorId);
}

async function updateSupabaseDebtorTotals(debtorId) {
    const [{data: loans, error: loansError}, {data: repayments, error: repaymentsError}] = await Promise.all([
        supabaseAdmin.from('loans').select('amount').eq('debtor_id', debtorId),
        supabaseAdmin.from('repayments').select('amount').eq('debtor_id', debtorId),
    ]);
    const error = loansError || repaymentsError;

    if (error) {
        throw new Error(error.message);
    }

    const borrowed = sumAmounts(loans || []);
    const repaid = sumAmounts(repayments || []);
    const {error: updateError} = await supabaseAdmin
        .from('debtors')
        .update({
            borrowed,
            repaid,
            remaining: borrowed - repaid,
            updated_at: new Date().toISOString(),
        })
        .eq('id', debtorId);

    if (updateError) {
        throw new Error(updateError.message);
    }
}

async function updateLocalDebtorTotals(debtorId) {
    await query(
        `
            UPDATE debtors
            SET
                borrowed = COALESCE((SELECT SUM(amount) FROM loans WHERE debtor_id = $1), 0),
                repaid = COALESCE((SELECT SUM(amount) FROM repayments WHERE debtor_id = $1), 0),
                remaining = COALESCE((SELECT SUM(amount) FROM loans WHERE debtor_id = $1), 0)
                    - COALESCE((SELECT SUM(amount) FROM repayments WHERE debtor_id = $1), 0),
                updated_at = NOW()
            WHERE id = $1
        `,
        [debtorId],
    );
}

async function getSupabaseDebtorSnapshot(debtorId) {
    const [debtorResponse, loansResponse, repaymentsResponse] = await Promise.all([
        supabaseAdmin
            .from('debtors')
            .select('id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url')
            .eq('id', debtorId)
            .single(),
        supabaseAdmin
            .from('loans')
            .select('id, debtor_id, amount, loan_date, due_date, notes, files')
            .eq('debtor_id', debtorId)
            .order('loan_date', {ascending: false, nullsFirst: false})
            .order('id', {ascending: false}),
        supabaseAdmin
            .from('repayments')
            .select('id, debtor_id, amount, repayment_date')
            .eq('debtor_id', debtorId)
            .order('repayment_date', {ascending: false, nullsFirst: false})
            .order('id', {ascending: false}),
    ]);
    const error = debtorResponse.error || loansResponse.error || repaymentsResponse.error;

    if (error) {
        throw new Error(error.message);
    }

    return mapDebtorSnapshot(debtorResponse.data, loansResponse.data || [], repaymentsResponse.data || []);
}

async function getLocalDebtorSnapshot(debtorId) {
    const [debtorResult, loansResult, repaymentsResult] = await Promise.all([
        query(
            `
                SELECT id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url
                FROM debtors
                WHERE id = $1
            `,
            [debtorId],
        ),
        query(
            `
                SELECT id, debtor_id, amount, loan_date, due_date, notes, files
                FROM loans
                WHERE debtor_id = $1
                ORDER BY loan_date DESC NULLS LAST, id DESC
            `,
            [debtorId],
        ),
        query(
            `
                SELECT id, debtor_id, amount, repayment_date
                FROM repayments
                WHERE debtor_id = $1
                ORDER BY repayment_date DESC NULLS LAST, id DESC
            `,
            [debtorId],
        ),
    ]);

    if (!debtorResult.rows[0]) {
        throw new Error('Боржника не знайдено.');
    }

    return mapDebtorSnapshot(debtorResult.rows[0], loansResult.rows, repaymentsResult.rows);
}

async function getNextSupabaseDebtorId() {
    return getNextSupabaseRecordId('debtors');
}

async function getNextSupabaseRecordId(tableName) {
    const {data, error} = await supabaseAdmin
        .from(tableName)
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

function mapDebtorSnapshot(debtorRow, loanRows, repaymentRows) {
    return {
        ...mapDebtor(debtorRow),
        loans: loanRows.map(row => ({
            id: row.id,
            amount: toNumber(row.amount),
            date: row.loan_date,
            dueDate: row.due_date,
            notes: row.notes || '',
            files: Array.isArray(row.files) ? row.files : [],
        })),
        repayments: repaymentRows.map(row => ({
            id: row.id,
            amount: toNumber(row.amount),
            date: row.repayment_date,
        })),
    };
}

function sumAmounts(rows) {
    return rows.reduce((total, row) => total + toNumber(row.amount), 0);
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

async function createSupabasePhotoUpload(input) {
    if (!supabaseAdmin) {
        throw new Error('Не задано SUPABASE_SERVICE_ROLE_KEY для завантаження фото в Supabase.');
    }

    const fileName = cleanText(input.fileName);
    const contentType = cleanText(input.contentType) || 'image/jpeg';

    if (!fileName) {
        throw new Error('Відсутня назва файлу.');
    }

    if (!contentType.startsWith('image/')) {
        throw new Error('Можна завантажувати тільки зображення.');
    }

    await ensurePhotoBucket();

    const objectPath = `profiles/${Date.now()}-${randomUUID()}${getSafeExtension(fileName, contentType)}`;
    const {data, error} = await supabaseAdmin.storage.from(photoBucketName).createSignedUploadUrl(objectPath);

    if (error) {
        throw new Error(error.message);
    }

    const {data: publicUrlData} = supabaseAdmin.storage.from(photoBucketName).getPublicUrl(objectPath);

    return {
        bucket: photoBucketName,
        path: data.path,
        token: data.token,
        publicUrl: publicUrlData.publicUrl,
    };
}

async function createSupabaseLoanFileUpload(input) {
    if (!supabaseAdmin) {
        throw new Error('Не задано SUPABASE_SERVICE_ROLE_KEY для завантаження файлів у Supabase.');
    }

    const fileName = cleanText(input.fileName);
    const contentType = cleanText(input.contentType) || 'application/octet-stream';
    const size = Number(input.size) || 0;

    if (!fileName) {
        throw new Error('Відсутня назва файлу.');
    }

    await ensureLoanFileBucket();

    const objectPath = `documents/${Date.now()}-${randomUUID()}${getSafeExtension(fileName, contentType)}`;
    const {data, error} = await supabaseAdmin.storage.from(loanFileBucketName).createSignedUploadUrl(objectPath);

    if (error) {
        throw new Error(error.message);
    }

    const {data: publicUrlData} = supabaseAdmin.storage.from(loanFileBucketName).getPublicUrl(objectPath);

    return {
        bucket: loanFileBucketName,
        path: data.path,
        token: data.token,
        file: {
            name: fileName,
            type: contentType,
            size,
            url: publicUrlData.publicUrl,
            path: data.path,
        },
    };
}

async function ensurePhotoBucket() {
    if (photoBucketReady) {
        return;
    }

    const {error} = await supabaseAdmin.storage.createBucket(photoBucketName, {
        public: true,
        fileSizeLimit: 1024 * 1024 * 10,
    });

    if (error && !/already exists|Duplicate/i.test(error.message)) {
        throw new Error(error.message);
    }

    photoBucketReady = true;
}

async function ensureLoanFileBucket() {
    if (loanFileBucketReady) {
        return;
    }

    const {error} = await supabaseAdmin.storage.createBucket(loanFileBucketName, {
        public: true,
        fileSizeLimit: 1024 * 1024 * 20,
    });

    if (error && !/already exists|Duplicate/i.test(error.message)) {
        throw new Error(error.message);
    }

    loanFileBucketReady = true;
}

function getSafeExtension(fileName, contentType) {
    const fromName = fileName.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
    const fromType = contentType.split('/')[1]?.split(';')[0]?.toLowerCase();
    const ext = fromName || fromType || 'jpg';
    return `.${ext.replace(/[^a-z0-9]/gi, '') || 'jpg'}`;
}
