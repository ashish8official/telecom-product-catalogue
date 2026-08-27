const { Client } = require('pg');
const fs = require('fs');

async function run() {
    const client = new Client({
        user: process.env.PGUSER || 'postgres',
        host: process.env.PGHOST || 'localhost',
        database: process.env.PGDATABASE || 'catalogue_db',
        password: process.env.PGPASSWORD || 'admin',
        port: process.env.PGPORT || 5433,
    });
    
    try {
        await client.connect();
        console.log("Connected to PostgreSQL");
        
        const files = [
            '../database/migrations/016_price_hardening.up.sql',
            '../database/tests/test_008_pricing.sql',
            '../database/tests/test_012_tax.sql',
            '../database/tests/test_015_override.sql'
        ];
        
        for (const file of files) {
            console.log(`Running ${file}...`);
            const sql = fs.readFileSync(file, 'utf8');
            await client.query(sql);
            console.log(`✅ Successfully ran ${file}`);
        }
        
    } catch (e) {
        console.error("❌ Error:", e.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

run();
