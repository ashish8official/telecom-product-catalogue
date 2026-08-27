const API_BASE = 'http://localhost:3000/api/internal';
const TENANT_ID = '17000000-0000-4000-a000-000000000000'; // Default test tenant from seed

document.getElementById('tenant-display').textContent = TENANT_ID;

// State
let catalogues = [];
let selectedCatalogueId = null;
let selectedVersionId = null;

async function fetchCatalogues() {
    try {
        const res = await fetch(`${API_BASE}/catalogues`, {
            headers: { 'x-tenant-id': TENANT_ID }
        });
        catalogues = await res.json();
        renderCatalogues();
    } catch (e) {
        console.error("Failed to fetch catalogues", e);
        document.getElementById('catalogues-container').innerHTML = `<div class="text-red-500 p-4">Error loading catalogues. Is backend running?</div>`;
    }
}

async function fetchVersions(catalogueId) {
    try {
        const res = await fetch(`${API_BASE}/catalogues/${catalogueId}/versions`, {
            headers: { 'x-tenant-id': TENANT_ID }
        });
        return await res.json();
    } catch (e) {
        console.error("Failed to fetch versions", e);
        return [];
    }
}

async function fetchOfferings(versionId) {
    try {
        const res = await fetch(`${API_BASE}/versions/${versionId}/offerings`, {
            headers: { 'x-tenant-id': TENANT_ID }
        });
        return await res.json();
    } catch (e) {
        console.error("Failed to fetch offerings", e);
        return [];
    }
}

function getBadgeClass(status) {
    switch (status.toUpperCase()) {
        case 'DRAFT': return 'badge-draft';
        case 'APPROVED': return 'badge-approved';
        case 'RELEASED': return 'badge-released';
        case 'RETIRED': return 'badge-retired';
        default: return 'bg-gray-100 text-gray-800';
    }
}

async function renderCatalogues() {
    const container = document.getElementById('catalogues-container');
    container.innerHTML = '';

    for (const cat of catalogues) {
        const catDiv = document.createElement('div');
        catDiv.className = 'mb-4 border border-slate-200 rounded overflow-hidden bg-white shadow-sm';
        
        const catHeader = document.createElement('div');
        catHeader.className = 'bg-slate-50 px-3 py-2 font-bold text-slate-700 border-b border-slate-200';
        catHeader.textContent = cat.name;
        catDiv.appendChild(catHeader);

        const versions = await fetchVersions(cat.id);
        const versionsList = document.createElement('div');
        
        versions.forEach(v => {
            const vBtn = document.createElement('button');
            vBtn.className = `w-full text-left px-4 py-2 text-sm border-b border-slate-100 hover:bg-blue-50 transition flex justify-between items-center ${selectedVersionId === v.id ? 'bg-blue-100' : ''}`;
            vBtn.onclick = () => selectVersion(cat, v);
            
            vBtn.innerHTML = `
                <span class="font-mono text-slate-600">${v.version}</span>
                <span class="badge ${getBadgeClass(v.status)}">${v.status}</span>
            `;
            versionsList.appendChild(vBtn);
        });

        catDiv.appendChild(versionsList);
        container.appendChild(catDiv);
    }
}

async function selectVersion(cat, version) {
    selectedCatalogueId = cat.id;
    selectedVersionId = version.id;
    
    // Re-render sidebar to update highlight
    renderCatalogues();

    const title = document.getElementById('version-title');
    const subtitle = document.getElementById('version-subtitle');
    
    title.innerHTML = `${cat.name} <span class="text-slate-400 font-normal">/</span> ${version.version}`;
    subtitle.innerHTML = `Status: <span class="badge ${getBadgeClass(version.status)}">${version.status}</span> | Valid From: ${version.valid_from ? new Date(version.valid_from).toLocaleDateString() : 'N/A'}`;

    const offeringsContainer = document.getElementById('offerings-container');
    offeringsContainer.innerHTML = '<div class="text-center text-slate-400 mt-10">Loading offerings...</div>';

    const offerings = await fetchOfferings(version.id);
    renderOfferings(offerings);
}

function renderOfferings(offerings) {
    const container = document.getElementById('offerings-container');
    container.innerHTML = '';

    if (offerings.length === 0) {
        container.innerHTML = '<div class="text-center text-slate-400 mt-10">No offerings found in this version.</div>';
        return;
    }

    offerings.forEach(off => {
        const card = document.createElement('div');
        card.className = 'bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden';
        
        const servicesHtml = (off.services || []).map(s => 
            `<span class="inline-block bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-xs mr-2 mb-2 font-mono">Service: ${s.service_name} (${s.service_code})</span>`
        ).join('');
        
        const chargesHtml = (off.charges || []).map(c => 
            `<div class="flex justify-between items-center py-1 border-b border-slate-100 last:border-0 text-sm">
                <span class="text-slate-600">${c.charge_name} <span class="text-xs text-slate-400 font-mono">(${c.charge_code})</span></span>
                <span class="text-xs font-bold bg-slate-100 px-2 py-0.5 rounded">Priority ${c.priority}</span>
            </div>`
        ).join('');

        card.innerHTML = `
            <div class="p-4 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                <div>
                    <h3 class="text-lg font-bold text-slate-800">${off.offering_name}</h3>
                    <div class="text-sm text-slate-500 font-mono mt-1">${off.offering_code}</div>
                </div>
                <div class="text-right">
                    <span class="badge bg-blue-100 text-blue-800">${off.offering_type}</span>
                    <span class="badge bg-purple-100 text-purple-800 ml-1">${off.service_type}</span>
                </div>
            </div>
            <div class="p-4 grid grid-cols-2 gap-4">
                <div>
                    <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Product Specification</h4>
                    <div class="text-sm font-semibold text-slate-700">${off.spec_name}</div>
                    <div class="text-xs font-mono text-slate-500">${off.spec_code}</div>
                    
                    <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4">Services Configured</h4>
                    <div class="flex flex-wrap">${servicesHtml || '<span class="text-sm text-slate-400 italic">None</span>'}</div>
                </div>
                <div class="border-l border-slate-100 pl-4">
                    <h4 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Charges & Stacking</h4>
                    <div class="flex flex-col">${chargesHtml || '<span class="text-sm text-slate-400 italic">No charges defined</span>'}</div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

// Init
fetchCatalogues();
