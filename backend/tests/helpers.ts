import crypto from 'crypto';
import request from 'supertest';
import { app } from '../app';
import { pool } from '../db/pool';

export const TMF = '/productCatalogManagement/v5';
export const API = '/api/internal';

/** Seed data (database/seeds/017_realistic_telecom_seed.sql). */
export const SEED = {
    tenant: '17000000-0000-4000-a000-000000000000',
    tenantB: '27000000-0000-4000-a000-000000000000',
    catalogue: '17000000-0000-4000-a000-000000000007',
    v1: '17000000-0000-4000-a000-000000000008',
    v2: '17000000-0000-4000-a000-000000000009',
    markets: {
        IND: '17000000-0000-4000-a000-000000000001',
        AFR: '17000000-0000-4000-a000-000000000002',
        NGA: '17000000-0000-4000-a000-000000000003',
        LAGOS: '17000000-0000-4000-a000-000000000004',
        KEN: '17000000-0000-4000-a000-000000000005',
        ZAF: '17000000-0000-4000-a000-000000000006',
    },
    specs: { m2m: '17000000-0000-4000-a000-000000000010' },
    offerings: {
        base: '17000000-0000-4000-a000-000000000012',
        staticIp: '17000000-0000-4000-a000-000000000013',
        voice: '17000000-0000-4000-a000-000000000014',
        premium: '17000000-0000-4000-a000-000000000024',
        v2Base: '17000000-0000-4000-a000-000000000080',
    },
    charges: { monthly: '17000000-0000-4000-a000-000000000015', activation: '17000000-0000-4000-a000-000000000025' },
    rates: { baseMonthlyNGA: '17000000-0000-4000-a000-000000000017' },
};

/** A supertest agent bound to one tenant. */
export function as(tenantId: string) {
    const withTenant = (r: request.Test) => r.set('x-tenant-id', tenantId);
    const agent = request(app);
    return {
        get: (url: string) => withTenant(agent.get(url)),
        post: (url: string, body?: object) => withTenant(agent.post(url)).send(body ?? {}),
        put: (url: string, body?: object) => withTenant(agent.put(url)).send(body ?? {}),
        patch: (url: string, body?: object) => withTenant(agent.patch(url)).send(body ?? {}),
        delete: (url: string) => withTenant(agent.delete(url)),
    };
}

export const newTenant = () => crypto.randomUUID();

/** Removes everything a test tenant created. Whole-catalogue deletion is allowed by the guards. */
export async function dropTenant(tenantId: string): Promise<void> {
    const t = [tenantId];
    await pool.query('DELETE FROM price_override WHERE tenant_id = $1', t);
    await pool.query('DELETE FROM catalogue WHERE tenant_id = $1', t);
    for (const table of [
        'journal_mapping', 'journal_configuration', 'tax_mapping', 'tax_configuration', 'policy_rule', 'policy_schema',
        'offering_category', 'charge_specification', 'service_specification', 'product_specification',
    ]) {
        await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, t);
    }
    await pool.query('UPDATE market_master SET parent_market_id = NULL WHERE tenant_id = $1', t);
    await pool.query('DELETE FROM market_master WHERE tenant_id = $1', t);
}

/**
 * Builds a small, fully priced, DRAFT catalogue through the internal API for one tenant:
 * GROUP > COUNTRY > CITY markets, one spec, one monthly charge, one offering priced in the country.
 */
export async function buildDraftCatalogue(tenantId: string) {
    const api = as(tenantId);
    const ok = (res: request.Response, status = 201) => {
        if (res.status !== status) throw new Error(`${(res as any).req.method} ${(res as any).req.path} -> ${res.status} ${JSON.stringify(res.body)}`);
        return res.body;
    };
    await api.put(`${API}/currencies/USD`, { currency_name: 'US Dollar' });
    const region = ok(await api.post(`${API}/markets`, { market_code: 'EMEA', market_name: 'EMEA', market_type: 'GROUP', is_pricing_market: false }));
    const country = ok(await api.post(`${API}/markets`, {
        market_code: 'UK', market_name: 'United Kingdom', parent_market_id: region.id, timezone: 'Europe/London', default_currency_code: 'USD',
    }));
    const city = ok(await api.post(`${API}/markets`, {
        market_code: 'LONDON', market_name: 'London', parent_market_id: country.id, market_type: 'CITY', timezone: 'Europe/London', default_currency_code: 'USD',
    }));
    const spec = ok(await api.post(`${API}/product-specifications`, { spec_code: 'BROADBAND', spec_name: 'Broadband' }));
    const charge = ok(await api.post(`${API}/charge-specifications`, {
        charge_code: 'RC_MONTHLY', charge_name: 'Monthly fee', charge_priority: 10, charge_type: 'RECURRING', charge_period: 'MONTH',
    }));
    const catalogue = ok(await api.post(`${API}/catalogues`, { name: 'Test Catalogue' }));
    const version = ok(await api.post(`${API}/versions`, { catalogue_id: catalogue.id, version: 'v1' }));
    const offering = ok(await api.post(`${API}/offerings`, {
        catalogue_version_id: version.id, product_specification_id: spec.id, offering_name: 'Fibre 500',
    }));
    ok(await api.post(`${API}/offerings/${offering.id}/charges`, { charge_spec_id: charge.id }));
    const rate = ok(await api.put(`${API}/offerings/${offering.id}/rates`, { charge_spec_id: charge.id, market_id: country.id, amount: '30.00' }), 200);
    return { api, ok, markets: { region, country, city }, spec, charge, catalogue, version, offering, rateId: rate.id as string };
}
