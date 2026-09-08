-- Snapshot-backed migration: within-page record cursor.
--
-- A snapshot Storage page file holds up to 1000 raw records (extractor
-- PAGE_SIZE), but the migration importer processes only one bounded batch
-- (100 records) per worker invocation. The read cursor previously tracked
-- only `next_page` (the Storage page-file index), so `snapshot-source`
-- derived `hasMore` purely from page-file count. A single 481-record page
-- file was therefore treated as fully consumed after the first 100-record
-- batch, silently dropping the remaining 381 records and marking the module
-- complete.
--
-- `page_offset` records how many records of the CURRENT page file have been
-- consumed. The reader now returns the window [page_offset, page_offset+100)
-- and only advances `next_page` (resetting `page_offset` to 0) once the whole
-- page file has been read. Existing rows default to 0, which for an
-- already-`exhausted` cursor is a no-op and for an in-flight cursor means the
-- current page file is re-read from its start (idempotent under the
-- update/skip duplicate strategies).

ALTER TABLE public.quickbooks_snapshot_read_cursors
  ADD COLUMN IF NOT EXISTS page_offset INT NOT NULL DEFAULT 0;
