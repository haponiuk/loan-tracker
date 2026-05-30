CREATE TABLE IF NOT EXISTS public.debtors (
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

CREATE TABLE IF NOT EXISTS public.loans (
    id TEXT PRIMARY KEY,
    debtor_id TEXT NOT NULL REFERENCES public.debtors(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    loan_date DATE,
    due_date DATE,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.repayments (
    id TEXT PRIMARY KEY,
    debtor_id TEXT NOT NULL REFERENCES public.debtors(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    repayment_date DATE,
    source TEXT NOT NULL DEFAULT 'local',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS loans_debtor_id_idx ON public.loans(debtor_id);
CREATE INDEX IF NOT EXISTS repayments_debtor_id_idx ON public.repayments(debtor_id);
CREATE INDEX IF NOT EXISTS loans_loan_date_idx ON public.loans(loan_date);
CREATE INDEX IF NOT EXISTS repayments_repayment_date_idx ON public.repayments(repayment_date);

ALTER TABLE public.debtors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read debtors" ON public.debtors;
DROP POLICY IF EXISTS "Public read loans" ON public.loans;
DROP POLICY IF EXISTS "Public read repayments" ON public.repayments;

CREATE POLICY "Public read debtors"
    ON public.debtors
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Public read loans"
    ON public.loans
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Public read repayments"
    ON public.repayments
    FOR SELECT
    TO anon, authenticated
    USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('debtor-photos', 'debtor-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Public read debtor photos" ON storage.objects;

CREATE POLICY "Public read debtor photos"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'debtor-photos');
