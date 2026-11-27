import type { Db } from '../db/pool';

export interface JournalResult {
    journal_config_id: string;
    gl_code: string;
    gl_description: string | null;
}

/** GL accounts mapped to a charge, for downstream billing. Never posts entries. */
export async function resolve_journal(db: Db, tenant_id: string, charge_spec_id: string): Promise<JournalResult[]> {
    const res = await db.query(
        `SELECT jc.id, jc.gl_code, jc.gl_description
           FROM journal_mapping jm
           JOIN journal_configuration jc ON jc.tenant_id = jm.tenant_id AND jc.id = jm.journal_configuration_id
          WHERE jm.tenant_id = $1 AND jm.charge_specification_id = $2
          ORDER BY jc.gl_code`,
        [tenant_id, charge_spec_id]
    );
    return res.rows.map((r) => ({ journal_config_id: r.id, gl_code: r.gl_code, gl_description: r.gl_description }));
}
