ALTER TABLE public.loans
ADD COLUMN IF NOT EXISTS files JSONB NOT NULL DEFAULT '[]'::JSONB;

INSERT INTO storage.buckets (id, name, public)
VALUES ('loan-files', 'loan-files', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Public read loan files" ON storage.objects;

CREATE POLICY "Public read loan files"
    ON storage.objects
    FOR SELECT
    TO anon, authenticated
    USING (bucket_id = 'loan-files');
