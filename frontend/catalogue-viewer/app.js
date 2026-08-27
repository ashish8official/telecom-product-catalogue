const API_BASE = 'http://localhost:3000/productCatalogManagement/v5';
const TENANT_ID = '17000000-0000-4000-a000-000000000000'; 

// In a real TMF scenario, tenant identification might be through auth headers.
const HEADERS = {
    'x-tenant-id': TENANT_ID,
    'Accept': 'application/json'
};

let currentOfferingId = null;

async function fetchOfferings() {
    try {
        const res = await fetch(`${API_BASE}/productOffering`, { headers: HEADERS });
        const offerings = await res.json();
        renderOfferings(offerings);
    } catch (e) {
        console.error("Error fetching offerings", e);
        document.getElementById('offerings-list').innerHTML = `<div class="text-red-500">Error connecting to TMF620 API</div>`;
    }
}

function renderOfferings(offerings) {
    const list = document.getElementById('offerings-list');
    list.innerHTML = '';
    
    offerings.forEach(offering => {
        const btn = document.createElement('button');
        btn.className = 'w-full text-left p-3 border rounded hover:bg-indigo-50 hover:border-indigo-300 transition block bg-gray-50';
        btn.onclick = () => selectOffering(offering);
        
        btn.innerHTML = `
            <div class="font-bold text-gray-800">${offering.name}</div>
            <div class="text-xs text-gray-500 font-mono mt-1 break-all">${offering.id}</div>
            <div class="text-xs mt-2 bg-gray-200 inline-block px-1 rounded">${offering.lifecycleStatus}</div>
        `;
        list.appendChild(btn);
    });
}

function selectOffering(offering) {
    currentOfferingId = offering.id;
    document.getElementById('empty-panel').classList.add('hidden');
    document.getElementById('selected-offering-panel').classList.remove('hidden');
    
    document.getElementById('selected-title').textContent = offering.name;
    document.getElementById('selected-id').textContent = `TMF ID: ${offering.id}`;
    
    // Clear old prices
    document.getElementById('prices-list').innerHTML = '<div class="text-gray-500 italic">Click "Resolve Prices" to query TMF API.</div>';
}

async function fetchPrices() {
    if (!currentOfferingId) return;

    const list = document.getElementById('prices-list');
    list.innerHTML = '<div class="text-gray-500 italic">Querying TMF620...</div>';

    const subId = document.getElementById('ctx-subscriber').value.trim();
    const accId = document.getElementById('ctx-account').value.trim();
    const mktId = document.getElementById('ctx-market').value.trim();

    // Standard TMF attribute filter: ?productOffering.id={id}
    const params = new URLSearchParams();
    params.append('productOffering.id', currentOfferingId);
    if (subId) params.append('subscriberId', subId);
    if (accId) params.append('accountId', accId);
    if (mktId) params.append('marketId', mktId);

    try {
        const url = `${API_BASE}/productOfferingPrice?${params.toString()}`;
        console.log(`GET ${url}`);
        
        const res = await fetch(url, { headers: HEADERS });
        const prices = await res.json();
        
        renderPrices(prices);
    } catch (e) {
        console.error("Error fetching prices", e);
        list.innerHTML = `<div class="text-red-500">Error connecting to TMF620 API</div>`;
    }
}

function renderPrices(prices) {
    const list = document.getElementById('prices-list');
    list.innerHTML = '';
    
    if (!prices || prices.length === 0) {
        list.innerHTML = '<div class="text-gray-500 italic">No prices returned for this context.</div>';
        return;
    }

    prices.forEach(price => {
        const card = document.createElement('div');
        card.className = 'border p-3 rounded bg-gray-50 flex justify-between items-center';
        
        card.innerHTML = `
            <div>
                <div class="font-bold text-gray-800">${price.name}</div>
                <div class="text-xs text-gray-500 font-mono">${price.id}</div>
                <div class="text-xs bg-indigo-100 text-indigo-800 inline-block px-1 rounded mt-1">${price.priceType}</div>
            </div>
            <div class="text-right">
                <div class="text-xl font-bold text-green-700">${price.price.value} ${price.price.unit}</div>
            </div>
        `;
        list.appendChild(card);
    });
}

// Start
fetchOfferings();
