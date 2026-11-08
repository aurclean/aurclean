-- PDFs no longer fall back to a shared platform logo: every firm prints only
-- its own. The original default firm previously relied on that shared file,
-- so give it an explicit reference to keep its documents unchanged. Never
-- overwrites a logo that has already been configured.
UPDATE "firms"
SET "logoUrl" = '/logo.png'
WHERE "id" = 'firm_aurclean_falnir' AND "logoUrl" IS NULL;
