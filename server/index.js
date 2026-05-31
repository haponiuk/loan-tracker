import 'dotenv/config';
import express from 'express';
import {query} from './db.js';

const app = express();
const port = Number(process.env.PORT) || 3001;

app.use(express.json());
app.use('/uploads', express.static('public/uploads'));

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
