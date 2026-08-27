import { Pool } from 'pg';

export interface JournalResult {
    journal_config_id: string;
    gl_code: string;
    gl_description: string;
}

export async function resolve_journal(
    pool: Pool,
    tenant_id: string,
    charge_spec_id: string
): Promise<JournalResult[]> {
    const query = `
        SELECT jc.id, jc.gl_code, jc.gl_description
        FROM journal_mapping jm
        JOIN journal_configuration jc ON jm.journal_configuration_id = jc.id
        WHERE jm.tenant_id = $1 AND jm.charge_specification_id = $2
    `;
    const res = await pool.query(query, [tenant_id, charge_spec_id]);
    
    return res.rows.map(r => ({
        journal_config_id: r.id,
        gl_code: r.gl_code,
        gl_description: r.gl_description
    }));
}
