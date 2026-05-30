import 'dotenv/config';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pool} from '../server/db.js';

const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appOq3gkhkagTaFGt';
const API_KEY = process.env.AIRTABLE_API_KEY || await readAirtableBlocksApiKey();
const API_ROOT = `https://api.airtable.com/v0/${BASE_ID}`;
const UPLOAD_DIR = new URL('../public/uploads/', import.meta.url);

if (!API_KEY) {
    throw new Error('Set AIRTABLE_API_KEY in .env or run block set-api-key before importing.');
}

const FIELD_NAMES = {
    debtors: {
        fullName: "Повне Ім'я",
        firstName: "Ім'я",
        lastName: 'Прізвище',
        borrowed: 'Загалом Позичив',
        repaid: 'Загалом Повернув',
        remaining: 'Залишилося Повернути',
        photo: 'Фото',
    },
    loans: {
        borrower: 'Боржник',
        amount: 'Сума Позики',
        date: 'Дата Позики',
        dueDate: 'Термін Повернення',
        notes: 'Notes',
    },
    repayments: {
        borrower: 'Боржник',
        amount: 'Сума Повернення',
        date: 'Дата Повернення',
    },
};

await fs.mkdir(UPLOAD_DIR, {recursive: true});

const [debtors, loans, repayments] = await Promise.all([
    fetchAllRecords('Debtors'),
    fetchAllRecords('Loans'),
    fetchAllRecords('Repayments'),
]);

const client = await pool.connect();

try {
    await client.query('BEGIN');
    await client.query("DELETE FROM repayments WHERE source = 'airtable'");
    await client.query("DELETE FROM loans WHERE source = 'airtable'");
    await client.query("DELETE FROM debtors WHERE source = 'airtable'");

    for (const record of debtors) {
        const fields = record.fields;
        const name = textValue(fields, FIELD_NAMES.debtors.fullName) || 'Без імені';
        const photoUrl = await importPhoto(record.id, fields[FIELD_NAMES.debtors.photo]);

        await client.query(
            `
                INSERT INTO debtors (
                    id, full_name, first_name, last_name, borrowed, repaid, remaining, photo_url, source
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'airtable')
            `,
            [
                record.id,
                name,
                textValue(fields, FIELD_NAMES.debtors.firstName),
                textValue(fields, FIELD_NAMES.debtors.lastName),
                numberValue(fields, FIELD_NAMES.debtors.borrowed),
                numberValue(fields, FIELD_NAMES.debtors.repaid),
                numberValue(fields, FIELD_NAMES.debtors.remaining),
                photoUrl,
            ],
        );
    }

    for (const record of loans) {
        const fields = record.fields;
        const debtorId = linkedRecordId(fields, FIELD_NAMES.loans.borrower);

        if (!debtorId) {
            continue;
        }

        await client.query(
            `
                INSERT INTO loans (id, debtor_id, amount, loan_date, due_date, notes, source)
                VALUES ($1, $2, $3, $4, $5, $6, 'airtable')
            `,
            [
                record.id,
                debtorId,
                numberValue(fields, FIELD_NAMES.loans.amount),
                dateValue(fields, FIELD_NAMES.loans.date),
                dateValue(fields, FIELD_NAMES.loans.dueDate),
                textValue(fields, FIELD_NAMES.loans.notes),
            ],
        );
    }

    for (const record of repayments) {
        const fields = record.fields;
        const debtorId = linkedRecordId(fields, FIELD_NAMES.repayments.borrower);

        if (!debtorId) {
            continue;
        }

        await client.query(
            `
                INSERT INTO repayments (id, debtor_id, amount, repayment_date, source)
                VALUES ($1, $2, $3, $4, 'airtable')
            `,
            [
                record.id,
                debtorId,
                numberValue(fields, FIELD_NAMES.repayments.amount),
                dateValue(fields, FIELD_NAMES.repayments.date),
            ],
        );
    }

    await client.query('COMMIT');
    console.log(
        `Imported ${debtors.length} debtors, ${loans.length} loans, ${repayments.length} repayments.`,
    );
} catch (error) {
    await client.query('ROLLBACK');
    throw error;
} finally {
    client.release();
    await pool.end();
}

async function fetchAllRecords(tableName) {
    const records = [];
    let offset = null;

    do {
        const url = new URL(`${API_ROOT}/${encodeURIComponent(tableName)}`);
        url.searchParams.set('pageSize', '100');
        if (offset) {
            url.searchParams.set('offset', offset);
        }

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${API_KEY}`,
            },
        });

        if (!response.ok) {
            throw new Error(`Airtable ${tableName} request failed: ${response.status}`);
        }

        const payload = await response.json();
        records.push(...payload.records);
        offset = payload.offset || null;
    } while (offset);

    return records;
}

async function importPhoto(recordId, attachments) {
    const attachment = Array.isArray(attachments) ? attachments[0] : null;
    const sourceUrl = attachment?.thumbnails?.large?.url || attachment?.url;

    if (!sourceUrl) {
        return null;
    }

    const extension = path.extname(attachment.filename || '') || '.jpg';
    const filename = `${recordId}${extension}`.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileUrl = new URL(filename, UPLOAD_DIR);
    const response = await fetch(sourceUrl);

    if (!response.ok) {
        return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(fileUrl, buffer);
    return `/uploads/${filename}`;
}

async function readAirtableBlocksApiKey() {
    try {
        const filePath = path.join(os.homedir(), '.config', '.airtableblocksrc.json');
        const raw = await fs.readFile(filePath, 'utf8');
        const config = JSON.parse(raw);
        if (typeof config.airtableApiKey?.default === 'string') {
            return config.airtableApiKey.default;
        }
        const serialized = JSON.stringify(config);
        const match = serialized.match(/pat[a-zA-Z0-9.]+/);
        return match?.[0] || '';
    } catch {
        return '';
    }
}

function textValue(fields, fieldName) {
    const value = fields[fieldName];
    return value === undefined || value === null ? '' : String(value).trim();
}

function numberValue(fields, fieldName) {
    const value = fields[fieldName];

    if (typeof value === 'number') {
        return value;
    }

    const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(fields, fieldName) {
    const value = fields[fieldName];
    return value ? String(value).slice(0, 10) : null;
}

function linkedRecordId(fields, fieldName) {
    const value = fields[fieldName];
    return Array.isArray(value) ? value[0] : null;
}
