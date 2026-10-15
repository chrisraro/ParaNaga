// Bulk-insert helpers shared by the import writers (scripts/lib/import-writer.ts, modes-writer.ts).
import type pg from "pg";

export type Row = Record<string, unknown>;

export type Column = [name: string, type: string, expr?: string];

/**
 * Bulk insert: `insert into <table> (<cols>) select <exprs> from jsonb_to_recordset($1) as x(<fields>)`.
 * Each column is also a recordset field and reads x.<name> unless it has an expression.
 * `inputs` are recordset fields that only feed expressions; `computed` are columns with no field.
 */
export async function insertRows(
  c: pg.ClientBase,
  table: string,
  rows: Row[],
  columns: Column[],
  extra: { inputs?: [string, string][]; computed?: [string, string][] } = {},
) {
  if (rows.length === 0) return 0;
  const targets: [string, string][] = [...columns.map(([n, , e]): [string, string] => [n, e ?? `x.${n}`]), ...(extra.computed ?? [])];
  const fields = [...columns.map(([n, t]) => `${n} ${t}`), ...(extra.inputs ?? []).map(([n, t]) => `${n} ${t}`)];
  const result = await c.query(
    `insert into ${table} (${targets.map(([n]) => n).join(", ")})
     select ${targets.map(([, e]) => e).join(", ")} from jsonb_to_recordset($1::jsonb) as x(${fields.join(", ")})`,
    [JSON.stringify(rows)],
  );
  if (result.rowCount !== rows.length) throw new Error(`${table}: inserted ${result.rowCount} of ${rows.length} rows`);
  return rows.length;
}

/** jsonb array (or null) -> text[] (or null), keeping order. */
export const textArray = (col: string) =>
  `case when x.${col} is null or jsonb_typeof(x.${col}) = 'null' then null
        else array(select e from jsonb_array_elements_text(x.${col}) with ordinality t(e, i) order by i) end`;
export const textArrayNotNull = (col: string) => `coalesce(${textArray(col)}, '{}')`;
/** jsonb array of numbers -> <type>[] (not null), keeping order. */
export const numberArray = (col: string, type: string) =>
  `coalesce(array(select e::${type} from jsonb_array_elements_text(x.${col}) with ordinality t(e, i) order by i), '{}')`;
export const point = (lon: string, lat: string) =>
  `case when x.${lon} is null or x.${lat} is null then null else
     extensions.ST_SetSRID(extensions.ST_MakePoint(x.${lon}::float8, x.${lat}::float8), 4326)::extensions.geography end`;

export const IMPORT_ACTOR = "scripts/import-naga";

/** A deliberate refusal (nothing written): the inputs conflict with what is committed. */
export class ImportRefusedError extends Error {}

/**
 * True when the published revision holds every member (same entity and version) of `revisionId`
 * of the given kinds: the batch's data is published, by that revision or by one that carried it forward.
 */
export async function publishedIncludes(c: pg.ClientBase, revisionId: string, kinds: string[]): Promise<boolean> {
  const { rows } = await c.query<{ missing: number; published: boolean }>(
    `select (select count(*)::int from transit.revision_member m
              where m.revision_id = $1 and m.entity_kind = any($2::text[])
                and not exists (select 1 from transit.revision_member pm join transit.published_pointer p
                                    on p.revision_id = pm.revision_id
                                 where pm.entity_kind = m.entity_kind and pm.entity_id = m.entity_id
                                   and pm.version_id = m.version_id)) as missing,
            exists (select 1 from transit.published_pointer) as published`,
    [revisionId, kinds],
  );
  return rows[0]!.published && rows[0]!.missing === 0;
}
