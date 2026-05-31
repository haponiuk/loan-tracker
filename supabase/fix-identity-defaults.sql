DO $$
DECLARE
    next_debtor_id BIGINT;
    next_loan_id BIGINT;
    next_repayment_id BIGINT;
BEGIN
    SELECT COALESCE(MAX(id), 0) + 1 INTO next_debtor_id FROM public.debtors;
    SELECT COALESCE(MAX(id), 0) + 1 INTO next_loan_id FROM public.loans;
    SELECT COALESCE(MAX(id), 0) + 1 INTO next_repayment_id FROM public.repayments;

    EXECUTE format('ALTER TABLE public.debtors ALTER COLUMN id RESTART WITH %s', next_debtor_id);
    EXECUTE format('ALTER TABLE public.loans ALTER COLUMN id RESTART WITH %s', next_loan_id);
    EXECUTE format('ALTER TABLE public.repayments ALTER COLUMN id RESTART WITH %s', next_repayment_id);
END $$;
