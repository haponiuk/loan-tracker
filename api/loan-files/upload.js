import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucketName = process.env.SUPABASE_LOAN_FILE_BUCKET || 'loan-files';

const supabase =
    supabaseUrl && serviceRoleKey
        ? createClient(supabaseUrl, serviceRoleKey, {
              auth: {
                  persistSession: false,
                  autoRefreshToken: false,
              },
          })
        : null;

let bucketReady = false;

export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        response.status(405).json({error: 'Метод не підтримується'});
        return;
    }

    if (!supabase) {
        response.status(500).json({error: 'Не задано серверні Supabase env-змінні для завантаження файлів.'});
        return;
    }

    try {
        const input = parseRequestBody(request.body);
        const fileName = cleanText(input.fileName);
        const contentType = cleanText(input.contentType) || 'application/octet-stream';
        const size = Number(input.size) || 0;

        if (!fileName) {
            response.status(400).json({error: 'Відсутня назва файлу.'});
            return;
        }

        await ensureBucket();

        const objectPath = `documents/${Date.now()}-${randomUUID()}${getSafeExtension(fileName, contentType)}`;
        const {data, error} = await supabase.storage.from(bucketName).createSignedUploadUrl(objectPath);

        if (error) {
            throw new Error(error.message);
        }

        const {data: publicUrlData} = supabase.storage.from(bucketName).getPublicUrl(objectPath);

        response.status(201).json({
            bucket: bucketName,
            path: data.path,
            token: data.token,
            file: {
                name: fileName,
                type: contentType,
                size,
                url: publicUrlData.publicUrl,
                path: data.path,
            },
        });
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

async function ensureBucket() {
    if (bucketReady) {
        return;
    }

    const {error} = await supabase.storage.createBucket(bucketName, {
        public: true,
        fileSizeLimit: 1024 * 1024 * 20,
    });

    if (error && !/already exists|Duplicate/i.test(error.message)) {
        throw new Error(error.message);
    }

    bucketReady = true;
}

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function getSafeExtension(fileName, contentType) {
    const fromName = fileName.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
    const fromType = contentType.split('/')[1]?.split(';')[0]?.toLowerCase();
    const ext = fromName || fromType || 'bin';
    return `.${ext.replace(/[^a-z0-9]/gi, '') || 'bin'}`;
}
