-- 0005_source_catalog_comment.sql
-- Documentation only (Task 4 review, minor 1): v_published_source_catalog carries the
-- v_published_ prefix but is NOT scoped to what the published revision cites: it is the whole
-- ingest.source catalogue next to the published revision id. Say so where every reader of the
-- schema will see it.

comment on view transit.v_published_source_catalog is
  'NOT a published-content view: the whole ingest.source catalogue next to the published revision id. '
  'Read it ONLY filtered by an explicit list of source codes that the read model cites from code '
  '(src/domain/search/legacy-route-names.ts INDEX_CODE_SOURCE_CODES, e.g. S28). '
  'Never list it unfiltered or treat its rows as cited by the published revision; use v_published_sources for that.';
