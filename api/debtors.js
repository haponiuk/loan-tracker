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
        const input = normalizeDebtorInput(request.body || {});
        const {data, error} = await supabase
            .from('debtors')
            .insert(input)
            .select('id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url')
            .single();

        if (error) {
            throw new Error(error.message);
        }

        response.status(201).json({debtor: mapDebtor(data)});
    } catch (error) {
        response.status(400).json({error: error.message});
    }
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
        full_name: fullName,
        first_name: firstName || null,
        last_name: lastName || null,
        photo_url: photoUrl || null,
    };
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

function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
