CREATE TABLE IF NOT EXISTS debtors (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    borrowed NUMERIC(12, 2) NOT NULL DEFAULT 0,
    repaid NUMERIC(12, 2) NOT NULL DEFAULT 0,
    remaining NUMERIC(12, 2) NOT NULL DEFAULT 0,
    photo_url TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    debtor_id TEXT NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    loan_date DATE,
    due_date DATE,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS repayments (
    id TEXT PRIMARY KEY,
    debtor_id TEXT NOT NULL REFERENCES debtors(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    repayment_date DATE,
    source TEXT NOT NULL DEFAULT 'local',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS loans_debtor_id_idx ON loans(debtor_id);
CREATE INDEX IF NOT EXISTS repayments_debtor_id_idx ON repayments(debtor_id);
CREATE INDEX IF NOT EXISTS loans_loan_date_idx ON loans(loan_date);
CREATE INDEX IF NOT EXISTS repayments_repayment_date_idx ON repayments(repayment_date);
