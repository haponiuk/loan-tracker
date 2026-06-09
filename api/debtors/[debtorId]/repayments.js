import {createClient} from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
    supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, {
              auth: {
                  persistSession: false,
                  autoRefreshToken: false,
              },
          })
        : null;

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        response.status(405).json({error: 'Метод не підтримується'});
        return;
    }

    if (!supabase) {
        response.status(500).json({error: 'Не задано серверні Supabase env-змінні'});
        return;
    }

    try {
        const input = normalizeRepaymentInput(request.query.debtorId, parseRequestBody(request.body));

        await insertRepayment(input);
        await updateDebtorTotals(input.debtorId);

        response.status(201).json({debtor: await getDebtorSnapshot(input.debtorId)});
    } catch (error) {
        response.status(400).json({error: error.message});
    }
}

function parseRequestBody(body) {
    if (!body) {
        return {};
    }

    if (typeof body === 'string') {
        return JSON.parse(body);
    }

    return body;
}

function normalizeRepaymentInput(debtorIdValue, input) {
    return {
        debtorId: normalizeId(Array.isArray(debtorIdValue) ? debtorIdValue[0] : debtorIdValue),
        amount: normalizeAmount(input.amount),
        date: normalizeDate(input.date, 'Вкажи дату повернення.'),
    };
}

async function insertRepayment(input) {
    const insertPayload = {
        debtor_id: input.debtorId,
        amount: input.amount,
        repayment_date: input.date,
    };
    const {error} = await supabase.from('repayments').insert(insertPayload);

    if (!error) {
        return;
    }

    if (!isMissingIdDefaultError(error)) {
        throw new Error(error.message);
    }

    const retry = await supabase
        .from('repayments')
        .insert({
            id: await getNextRecordId('repayments'),
            ...insertPayload,
        });

    if (retry.error) {
        throw new Error(retry.error.message);
    }
}

async function updateDebtorTotals(debtorId) {
    const [{data: loans, error: loansError}, {data: repayments, error: repaymentsError}] = await Promise.all([
        supabase.from('loans').select('amount').eq('debtor_id', debtorId),
        supabase.from('repayments').select('amount').eq('debtor_id', debtorId),
    ]);
    const error = loansError || repaymentsError;

    if (error) {
        throw new Error(error.message);
    }

    const borrowed = sumAmounts(loans || []);
    const repaid = sumAmounts(repayments || []);
    const {error: updateError} = await supabase
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

async function getDebtorSnapshot(debtorId) {
    const [debtorResponse, loansResponse, repaymentsResponse] = await Promise.all([
        supabase
            .from('debtors')
            .select('id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url')
            .eq('id', debtorId)
            .single(),
        supabase
            .from('loans')
            .select('id, debtor_id, amount, loan_date, due_date, notes, files')
            .eq('debtor_id', debtorId)
            .order('loan_date', {ascending: false, nullsFirst: false})
            .order('id', {ascending: false}),
        supabase
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

async function getNextRecordId(tableName) {
    const {data, error} = await supabase
        .from(tableName)
        .select('id')
        .order('id', {ascending: false})
        .limit(1);

    if (error) {
        throw new Error(error.message);
    }

    return Number(data?.[0]?.id || 0) + 1;
}

function mapDebtorSnapshot(debtorRow, loanRows, repaymentRows) {
    return {
        id: debtorRow.id,
        name: debtorRow.full_name,
        firstName: debtorRow.first_name || '',
        lastName: debtorRow.last_name || '',
        borrowed: toNumber(debtorRow.borrowed),
        repaid: toNumber(debtorRow.repaid),
        remaining: toNumber(debtorRow.remaining),
        photoUrl: debtorRow.photo_url,
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

function isMissingIdDefaultError(error) {
    return error?.code === '23502' && error?.message?.includes('column "id"');
}

function cleanText(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sumAmounts(rows) {
    return rows.reduce((total, row) => total + toNumber(row.amount), 0);
}
