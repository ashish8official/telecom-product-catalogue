import { Client } from 'pg';
import { createPriceOverride, PriceOverride } from './priceOverrideService';


describe('Price Override Service Layer Validation', () => {
    let client: Client;
    let tenantId = '00000000-0000-0000-0000-000000000000'; // Set dynamically
    let offeringRateId = '';
    let marketId = '';
    let chargeSpecId = '';
    const now = new Date();

    beforeAll(async () => {
        client = new Client({
            user: process.env.PGUSER || 'postgres',
            host: process.env.PGHOST || 'localhost',
            database: process.env.PGDATABASE || 'catalogue_db',
            password: process.env.PGPASSWORD || 'admin',
            port: parseInt(process.env.PGPORT || '5433', 10),
        });
        await client.connect();

        // Setup test data
        const tenantRes = await client.query(`SELECT gen_random_uuid() as id`);
        tenantId = tenantRes.rows[0].id;

        const mktRes = await client.query(
            `INSERT INTO market_master (tenant_id, market_code, market_name) VALUES ($1, 'TEST_MKT', 'Test Market') RETURNING id`,
            [tenantId]
        );
        marketId = mktRes.rows[0].id;

        const chgRes = await client.query(
            `INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_priority)
             VALUES ($1, 'TEST_CHG', 'Test Charge', 'ADDITIVE', 'FLAT', 1) RETURNING id`,
            [tenantId]
        );
        chargeSpecId = chgRes.rows[0].id;

        await client.query(`INSERT INTO currency_master (currency_code, currency_name) VALUES ('USD', 'US Dollar') ON CONFLICT DO NOTHING`);

        const rateRes = await client.query(
            `INSERT INTO offering_rate (tenant_id, charge_spec_id, market_id, currency_code, amount)
             VALUES ($1, $2, $3, 'USD', 1299.00) RETURNING id`,
            [tenantId, chargeSpecId, marketId]
        );
        offeringRateId = rateRes.rows[0].id;
    });

    afterAll(async () => {
        await client.end();
    });

    it('1. Non-overlapping override accepted.', async () => {
        const override: PriceOverride = {
            tenant_id: tenantId,
            offering_rate_id: offeringRateId,
            scope_type: 'SUBSCRIBER',
            scope_reference_id: 'SUB_1',
            override_amount: 10.00,
            effective_from: new Date(now.getTime() - 86400000 * 10), // -10 days
            effective_to: new Date(now.getTime() - 86400000 * 5)    // -5 days
        };

        const id = await createPriceOverride(client, override);
        expect(id).toBeDefined();
    });

    it('2. Overlapping same-scope override rejected.', async () => {
        const override: PriceOverride = {
            tenant_id: tenantId,
            offering_rate_id: offeringRateId,
            scope_type: 'SUBSCRIBER',
            scope_reference_id: 'SUB_1',
            override_amount: 15.00,
            effective_from: new Date(now.getTime() - 86400000 * 7), // overlaps with above [-10, -5]
            effective_to: new Date(now.getTime())
        };

        await expect(createPriceOverride(client, override)).rejects.toThrow(/Overlapping price override detected/);
    });

    it('3. Different subscriber accepted.', async () => {
        const override: PriceOverride = {
            tenant_id: tenantId,
            offering_rate_id: offeringRateId,
            scope_type: 'SUBSCRIBER',
            scope_reference_id: 'SUB_2',
            override_amount: 20.00,
            effective_from: new Date(now.getTime() - 86400000 * 7),
            effective_to: new Date(now.getTime())
        };
        const id = await createPriceOverride(client, override);
        expect(id).toBeDefined();
    });

    it('4. Different account accepted.', async () => {
        const override: PriceOverride = {
            tenant_id: tenantId,
            offering_rate_id: offeringRateId,
            scope_type: 'ACCOUNT',
            scope_reference_id: 'SUB_1', // Using same ID string but different scope
            override_amount: 25.00,
            effective_from: new Date(now.getTime() - 86400000 * 7),
            effective_to: new Date(now.getTime())
        };
        const id = await createPriceOverride(client, override);
        expect(id).toBeDefined();
    });

    it('5. Different market accepted.', async () => {
        const override: PriceOverride = {
            tenant_id: tenantId,
            offering_rate_id: offeringRateId,
            scope_type: 'MARKET',
            scope_reference_id: 'SUB_1',
            override_amount: 30.00,
            effective_from: new Date(now.getTime() - 86400000 * 7),
            effective_to: new Date(now.getTime())
        };
        const id = await createPriceOverride(client, override);
        expect(id).toBeDefined();
    });

    it('6. Different offering_rate accepted.', async () => {
        const chgRes2 = await client.query(
            `INSERT INTO charge_specification (tenant_id, charge_code, charge_name, stacking_rule, calculation_type, charge_priority)
             VALUES ($1, 'TEST_CHG_2', 'Test Charge 2', 'ADDITIVE', 'FLAT', 1) RETURNING id`,
            [tenantId]
        );
        const chargeSpecId2 = chgRes2.rows[0].id;

        const rateRes2 = await client.query(
            `INSERT INTO offering_rate (tenant_id, charge_spec_id, market_id, currency_code, amount)
             VALUES ($1, $2, $3, 'USD', 999.00) RETURNING id`,
            [tenantId, chargeSpecId2, marketId]
        );
        const offeringRateId2 = rateRes2.rows[0].id;

        const override: PriceOverride = {
            tenant_id: tenantId,
            offering_rate_id: offeringRateId2,
            scope_type: 'SUBSCRIBER',
            scope_reference_id: 'SUB_1',
            override_amount: 35.00,
            effective_from: new Date(now.getTime() - 86400000 * 7),
            effective_to: new Date(now.getTime())
        };
        const id = await createPriceOverride(client, override);
        expect(id).toBeDefined();
    });

    it('7. Expired historical override does not block a new period.', async () => {
        // We already inserted SUB_1 for [-10, -5] in Test 1.
        // Let's insert a new one starting at -4 days.
        const override: PriceOverride = {
            tenant_id: tenantId,
            offering_rate_id: offeringRateId,
            scope_type: 'SUBSCRIBER',
            scope_reference_id: 'SUB_1',
            override_amount: 40.00,
            effective_from: new Date(now.getTime() - 86400000 * 4), 
            effective_to: new Date(now.getTime() - 86400000 * 1)    
        };
        const id = await createPriceOverride(client, override);
        expect(id).toBeDefined();
    });

    it('8. Future non-overlapping override accepted.', async () => {
        const override: PriceOverride = {
            tenant_id: tenantId,
            offering_rate_id: offeringRateId,
            scope_type: 'SUBSCRIBER',
            scope_reference_id: 'SUB_1',
            override_amount: 45.00,
            effective_from: new Date(now.getTime() + 86400000 * 1), 
            effective_to: null    
        };
        const id = await createPriceOverride(client, override);
        expect(id).toBeDefined();
    });

    it('9. Concurrent conflicting writes cannot both succeed.', async () => {
        // Create 2 separate clients to simulate concurrent web requests
        const clientA = new Client({
            user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || 'localhost',
            database: process.env.PGDATABASE || 'catalogue_db', password: process.env.PGPASSWORD || 'admin',
            port: parseInt(process.env.PGPORT || '5433', 10),
        });
        const clientB = new Client({
            user: process.env.PGUSER || 'postgres', host: process.env.PGHOST || 'localhost',
            database: process.env.PGDATABASE || 'catalogue_db', password: process.env.PGPASSWORD || 'admin',
            port: parseInt(process.env.PGPORT || '5433', 10),
        });

        await clientA.connect();
        await clientB.connect();

        const overrideA: PriceOverride = {
            tenant_id: tenantId, offering_rate_id: offeringRateId, scope_type: 'SUBSCRIBER', scope_reference_id: 'SUB_CONCURRENT',
            override_amount: 50.00, effective_from: new Date(now.getTime() + 86400000 * 10), effective_to: null
        };
        const overrideB: PriceOverride = { ...overrideA, override_amount: 60.00 };

        try {
            // Run them simultaneously
            const [resA, resB] = await Promise.allSettled([
                createPriceOverride(clientA, overrideA),
                createPriceOverride(clientB, overrideB)
            ]);

            // One should fulfill and one should reject due to overlap
            const fulfilled = [resA, resB].filter(r => r.status === 'fulfilled');
            const rejected = [resA, resB].filter(r => r.status === 'rejected');

            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(1);
            expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/Overlapping price override detected/);
        } finally {
            await clientA.end();
            await clientB.end();
        }
    });

    it('10. offering_rate remains unchanged.', async () => {
        const rateRes = await client.query(`SELECT amount FROM offering_rate WHERE id = $1`, [offeringRateId]);
        expect(parseFloat(rateRes.rows[0].amount)).toBe(1299.00);
    });
});
