import { Pool } from 'pg';
import { ResolutionContext } from '../domain/ResolutionContext';

export interface PolicyResult {
    passed: boolean;
    failed_rule_ids: string[];
    evaluated_rules: any[];
}

export async function resolve_policy(
    pool: Pool,
    context: ResolutionContext,
    mode: 'ALL' | 'ANY' = 'ALL'
): Promise<PolicyResult> {
    const { tenant_id, offering_id, context_json = {}, effective_at, market_id } = context;

    // 1. Fetch mapped policies
    const query = `
        SELECT pr.id, pr.rule_json 
        FROM policy_mapping pm
        JOIN policy_rule pr ON pm.policy_rule_id = pr.id
        WHERE pm.tenant_id = $1 AND pm.product_offering_id = $2
        ORDER BY pr.id ASC
    `;
    const res = await pool.query(query, [tenant_id, offering_id]);
    const rules = res.rows;

    if (rules.length === 0) {
        return { passed: true, failed_rule_ids: [], evaluated_rules: [] };
    }

    // 2. Fetch market timezone if market_id is provided
    let timezone = 'UTC';
    if (market_id) {
        const tzRes = await pool.query(`SELECT timezone FROM market_master WHERE id = $1 AND tenant_id = $2`, [market_id, tenant_id]);
        if (tzRes.rows.length > 0 && tzRes.rows[0].timezone) {
            timezone = tzRes.rows[0].timezone;
        }
    }

    const failedRuleIds: string[] = [];
    const evaluatedRules: any[] = [];

    for (const rule of rules) {
        const ruleId = rule.id;
        const ruleJson = rule.rule_json;
        let rulePassed = true;
        const evaluationDetails: any = { rule_id: ruleId, checks: [] };

        // 3. Evaluate basic JSON match logic
        for (const [key, expectedValue] of Object.entries(ruleJson)) {
            if (key === 'time_window' && typeof expectedValue === 'object' && expectedValue !== null) {
                const { start, end } = expectedValue as { start: string, end: string };
                // Timezone aware check
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: timezone,
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                const localTimeString = formatter.format(effective_at);
                const localMinutes = parseTimeToMinutes(localTimeString);
                const startMinutes = parseTimeToMinutes(start);
                const endMinutes = parseTimeToMinutes(end);

                let isWithin = false;
                if (startMinutes <= endMinutes) {
                    isWithin = localMinutes >= startMinutes && localMinutes <= endMinutes;
                } else {
                    // Crosses midnight (e.g. 22:00 to 06:00)
                    isWithin = localMinutes >= startMinutes || localMinutes <= endMinutes;
                }

                evaluationDetails.checks.push({ key, passed: isWithin, localTime: localTimeString });
                if (!isWithin) rulePassed = false;
            } else {
                // Simple equality match for context_json fields (e.g. account_category)
                const actualValue = context_json[key];
                const passed = actualValue === expectedValue;
                evaluationDetails.checks.push({ key, passed, expected: expectedValue, actual: actualValue });
                if (!passed) rulePassed = false;
            }
        }

        evaluationDetails.passed = rulePassed;
        evaluatedRules.push(evaluationDetails);
        if (!rulePassed) failedRuleIds.push(ruleId);
    }

    let finalPassed = false;
    if (mode === 'ALL') {
        finalPassed = failedRuleIds.length === 0;
    } else if (mode === 'ANY') {
        finalPassed = failedRuleIds.length < rules.length;
    }

    return {
        passed: finalPassed,
        failed_rule_ids: failedRuleIds,
        evaluated_rules: evaluatedRules
    };
}

function parseTimeToMinutes(timeStr: string): number {
    // Expected format HH:mm or HH:mm:ss
    const match = timeStr.match(/^(\d{2}):(\d{2})/);
    if (!match) return 0;
    // Intl format sometimes returns "24:00" for midnight. Handle that.
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours === 24) hours = 0;
    return hours * 60 + minutes;
}
