-- Company-level document numbering (invoice and future document types).
-- Single source of truth: public.document_sequences
-- Do not derive next numbers from the invoices table at allocation time.

CREATE TABLE IF NOT EXISTS public.document_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT 'INV-',
  starting_number BIGINT NOT NULL DEFAULT 1,
  next_number BIGINT NOT NULL DEFAULT 1,
  padding INT NOT NULL DEFAULT 6,
  suffix TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT document_sequences_company_type_uniq UNIQUE (company_id, document_type),
  CONSTRAINT document_sequences_padding_chk CHECK (padding >= 0 AND padding <= 10),
  CONSTRAINT document_sequences_next_positive_chk CHECK (next_number >= 1),
  CONSTRAINT document_sequences_starting_positive_chk CHECK (starting_number >= 1),
  CONSTRAINT document_sequences_prefix_len_chk CHECK (char_length(prefix) BETWEEN 1 AND 20)
);

CREATE INDEX IF NOT EXISTS document_sequences_company_id_idx
  ON public.document_sequences (company_id);

DROP TRIGGER IF EXISTS document_sequences_set_updated_at ON public.document_sequences;
CREATE TRIGGER document_sequences_set_updated_at
  BEFORE UPDATE ON public.document_sequences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.document_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_sequences_tenant ON public.document_sequences;
CREATE POLICY document_sequences_tenant ON public.document_sequences
  FOR ALL TO authenticated
  USING (company_id IN (SELECT public.user_company_ids()))
  WITH CHECK (company_id IN (SELECT public.user_company_ids()));

DROP POLICY IF EXISTS document_sequences_service ON public.document_sequences;
CREATE POLICY document_sequences_service ON public.document_sequences
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Format a document number from sequence parts.
CREATE OR REPLACE FUNCTION public.format_document_number(
  p_prefix TEXT,
  p_number BIGINT,
  p_padding INT,
  p_suffix TEXT DEFAULT ''
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_padding IS NULL OR p_padding <= 0 THEN
    RETURN coalesce(p_prefix, '') || p_number::text || coalesce(p_suffix, '');
  END IF;
  RETURN coalesce(p_prefix, '')
    || lpad(p_number::text, p_padding, '0')
    || coalesce(p_suffix, '');
END;
$$;

-- Ensure a sequence row exists for a company + document type (idempotent).
CREATE OR REPLACE FUNCTION public.ensure_document_sequence(
  p_company_id UUID,
  p_document_type TEXT,
  p_prefix TEXT DEFAULT NULL,
  p_padding INT DEFAULT 6,
  p_starting_number BIGINT DEFAULT 1
)
RETURNS public.document_sequences
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.document_sequences;
  v_prefix TEXT;
BEGIN
  v_prefix := coalesce(
    nullif(trim(p_prefix), ''),
    CASE upper(p_document_type)
      WHEN 'INVOICE' THEN 'INV-'
      WHEN 'ESTIMATE' THEN 'EST-'
      WHEN 'PURCHASE_ORDER' THEN 'PO-'
      WHEN 'BILL' THEN 'BILL-'
      WHEN 'CREDIT_NOTE' THEN 'CN-'
      WHEN 'DEBIT_NOTE' THEN 'DN-'
      WHEN 'VENDOR_CREDIT' THEN 'VC-'
      WHEN 'SALES_ORDER' THEN 'SO-'
      WHEN 'SALES_RECEIPT' THEN 'SR-'
      WHEN 'EXPENSE' THEN 'EXP-'
      ELSE left(upper(p_document_type), 3) || '-'
    END
  );

  INSERT INTO public.document_sequences (
    company_id,
    document_type,
    prefix,
    starting_number,
    next_number,
    padding,
    suffix
  )
  VALUES (
    p_company_id,
    upper(p_document_type),
    v_prefix,
    greatest(coalesce(p_starting_number, 1), 1),
    greatest(coalesce(p_starting_number, 1), 1),
    least(greatest(coalesce(p_padding, 6), 0), 10),
    ''
  )
  ON CONFLICT (company_id, document_type) DO NOTHING;

  SELECT * INTO v_row
  FROM public.document_sequences
  WHERE company_id = p_company_id
    AND document_type = upper(p_document_type);

  RETURN v_row;
END;
$$;

-- Atomically allocate the next document number and increment the sequence.
CREATE OR REPLACE FUNCTION public.allocate_document_number(
  p_company_id UUID,
  p_document_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.document_sequences;
  v_number BIGINT;
  v_formatted TEXT;
BEGIN
  PERFORM public.ensure_document_sequence(p_company_id, p_document_type);

  SELECT *
  INTO v_row
  FROM public.document_sequences
  WHERE company_id = p_company_id
    AND document_type = upper(p_document_type)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document sequence not found for % / %', p_company_id, p_document_type;
  END IF;

  v_number := v_row.next_number;

  UPDATE public.document_sequences
  SET next_number = next_number + 1,
      updated_at = now()
  WHERE id = v_row.id;

  v_formatted := public.format_document_number(
    v_row.prefix,
    v_number,
    v_row.padding,
    v_row.suffix
  );

  RETURN v_formatted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.format_document_number(TEXT, BIGINT, INT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_document_sequence(UUID, TEXT, TEXT, INT, BIGINT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.allocate_document_number(UUID, TEXT) TO authenticated, service_role;

-- Seed INVOICE sequences for every existing company.
INSERT INTO public.document_sequences (
  company_id,
  document_type,
  prefix,
  starting_number,
  next_number,
  padding,
  suffix
)
SELECT
  c.id,
  'INVOICE',
  coalesce(nullif(trim(cs.invoice_prefix), ''), 'INV-'),
  1,
  1,
  6,
  ''
FROM public.companies c
LEFT JOIN public.company_settings cs ON cs.company_id = c.id
ON CONFLICT (company_id, document_type) DO NOTHING;

-- Prefer legacy sequences.next_no when present.
UPDATE public.document_sequences ds
SET
  next_number = greatest(ds.next_number, s.next_no),
  prefix = CASE
    WHEN nullif(trim(s.prefix), '') IS NOT NULL THEN s.prefix
    ELSE ds.prefix
  END,
  updated_at = now()
FROM public.sequences s
WHERE s.company_id = ds.company_id
  AND s.type = 'INVOICE'
  AND ds.document_type = 'INVOICE';

-- Bump next_number past the highest trailing numeric invoice number already issued.
WITH invoice_max AS (
  SELECT
    i.company_id,
    max(
      CASE
        WHEN i.invoice_no ~ '[0-9]+$'
          THEN nullif(regexp_replace(i.invoice_no, '^.*?([0-9]+)$', '\1'), '')::bigint
        ELSE NULL
      END
    ) AS max_num
  FROM public.invoices i
  WHERE i.deleted_at IS NULL
  GROUP BY i.company_id
)
UPDATE public.document_sequences ds
SET
  next_number = greatest(ds.next_number, invoice_max.max_num + 1),
  updated_at = now()
FROM invoice_max
WHERE invoice_max.company_id = ds.company_id
  AND ds.document_type = 'INVOICE'
  AND invoice_max.max_num IS NOT NULL;
