-- Repair corrupt document_sequences initialized from ZATCA test prefixes
-- or timestamp-sized trailing digits scraped from unrelated invoice numbers.
--
-- Valid accounting sequences are 1 .. 999999999 (max 9 digits).

CREATE OR REPLACE FUNCTION public.extract_plausible_invoice_sequence(
  p_invoice_no TEXT,
  p_prefix TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_body TEXT;
  v_digits TEXT;
  v_num BIGINT;
BEGIN
  IF p_invoice_no IS NULL OR p_prefix IS NULL OR length(trim(p_prefix)) = 0 THEN
    RETURN NULL;
  END IF;

  IF left(upper(p_invoice_no), length(p_prefix)) <> upper(p_prefix) THEN
    RETURN NULL;
  END IF;

  v_body := substr(p_invoice_no, length(p_prefix) + 1);
  v_digits := (regexp_match(v_body, '^(\d{1,9})(?:\D.*)?$'))[1];
  IF v_digits IS NULL THEN
    RETURN NULL;
  END IF;

  v_num := v_digits::bigint;
  IF v_num < 1 OR v_num > 999999999 THEN
    RETURN NULL;
  END IF;

  RETURN v_num;
END;
$$;

-- Restore prefix from company_settings (never keep ZAT- on the INVOICE series).
UPDATE public.document_sequences ds
SET
  prefix = coalesce(nullif(trim(cs.invoice_prefix), ''), 'INV-'),
  updated_at = now()
FROM public.company_settings cs
WHERE cs.company_id = ds.company_id
  AND ds.document_type = 'INVOICE'
  AND (
    upper(trim(ds.prefix)) LIKE 'ZAT%'
    OR ds.next_number > 999999999
    OR ds.starting_number > 999999999
  );

UPDATE public.document_sequences ds
SET
  prefix = 'INV-',
  updated_at = now()
WHERE ds.document_type = 'INVOICE'
  AND (
    upper(trim(ds.prefix)) LIKE 'ZAT%'
    OR ds.next_number > 999999999
    OR ds.starting_number > 999999999
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.company_settings cs WHERE cs.company_id = ds.company_id
  );

-- Recompute next_number from invoices that match the (restored) prefix only.
WITH invoice_max AS (
  SELECT
    ds.company_id,
    ds.prefix,
    max(public.extract_plausible_invoice_sequence(i.invoice_no, ds.prefix)) AS max_num
  FROM public.document_sequences ds
  LEFT JOIN public.invoices i
    ON i.company_id = ds.company_id
   AND i.deleted_at IS NULL
  WHERE ds.document_type = 'INVOICE'
  GROUP BY ds.company_id, ds.prefix
)
UPDATE public.document_sequences ds
SET
  starting_number = CASE
    WHEN ds.starting_number > 999999999 OR ds.starting_number < 1 THEN 1
    ELSE ds.starting_number
  END,
  next_number = greatest(
    1,
    coalesce(invoice_max.max_num + 1, 1)
  ),
  padding = CASE
    WHEN ds.padding IS NULL OR ds.padding < 0 OR ds.padding > 10 THEN 6
    ELSE ds.padding
  END,
  updated_at = now()
FROM invoice_max
WHERE invoice_max.company_id = ds.company_id
  AND ds.document_type = 'INVOICE';

-- Clamp any remaining corrupt rows.
UPDATE public.document_sequences
SET
  next_number = 1,
  starting_number = 1,
  updated_at = now()
WHERE document_type = 'INVOICE'
  AND (next_number > 999999999 OR next_number < 1 OR starting_number > 999999999 OR starting_number < 1);
