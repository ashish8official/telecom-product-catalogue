/* Catalogue viewer: behaves like an external CRM and uses nothing but TMF620 JSON. */
(function () {
    'use strict';
    const { h, clear, toast, request, errorText, money, statusBadge, session, SEED_TENANTS, store } = window.Catalogue;
    const TMF = '/productCatalogManagement/v5';
    const view = document.getElementById('view');

    const state = {
        offerings: [],
        catalogs: [],
        categories: [],
        places: [],
        marketId: store.get('viewer.marketId', ''),
        subscriberId: '',
        accountId: '',
        category: '',
        selected: null,
        lastRequest: '',
    };

    async function tmf(path) {
        state.lastRequest = `GET ${TMF}${path}`;
        const { data, headers } = await request('GET', TMF + path);
        return { data, total: Number(headers.get('X-Total-Count') || (Array.isArray(data) ? data.length : 1)) };
    }

    async function load() {
        const [offerings, catalogs, categories, allPrices] = await Promise.all([
            tmf('/productOffering?limit=1000'),
            tmf('/catalog'),
            tmf('/category'),
            tmf('/productOfferingPrice?limit=1000'),
        ]);
        state.offerings = offerings.data;
        state.catalogs = catalogs.data;
        state.categories = categories.data;
        // Markets are not a TMF620 resource; the viewer learns them from the places prices apply to.
        const places = new Map();
        for (const p of allPrices.data) for (const pl of p.place || []) places.set(pl.id, pl.name);
        state.places = [...places].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
        if (!state.places.some((p) => p.id === state.marketId)) state.marketId = state.places[0] ? state.places[0].id : '';
    }

    async function pricesFor(offeringId) {
        const q = new URLSearchParams({ 'productOffering.id': offeringId });
        if (state.marketId) q.set('marketId', state.marketId);
        if (state.subscriberId) q.set('subscriberId', state.subscriberId);
        if (state.accountId) q.set('accountId', state.accountId);
        return (await tmf(`/productOfferingPrice?${q}`)).data;
    }

    function renderSessionBar() {
        const bar = clear(document.getElementById('session-bar'));
        if (session.apiKey()) {
            bar.append(h('span.small.muted', 'Using API key'));
            return;
        }
        const sel = h('select', { 'aria-label': 'Tenant' }, SEED_TENANTS.map((t) => {
            const o = h('option', { value: t.id }, t.label);
            if (t.id === session.tenantId()) o.selected = true;
            return o;
        }));
        sel.addEventListener('change', async () => {
            session.setTenantId(sel.value);
            state.selected = null;
            await start();
        });
        bar.append(sel);
    }

    function priceSummary(prices) {
        const recurring = prices.filter((p) => p.priceType === 'recurring' && p.price);
        const oneTime = prices.filter((p) => p.priceType === 'oneTime' && p.price);
        const sum = (ps) => ps.reduce((acc, p) => acc + p.price.value, 0);
        const pct = prices.filter((p) => p.percentage !== undefined);
        // Percentage charges apply to the recurring subtotal in this demo display.
        const recurringTotal = sum(recurring) * (1 + pct.reduce((a, p) => a + p.percentage, 0) / 100);
        const unit = (recurring[0] || oneTime[0] || {}).price?.unit;
        return { recurringTotal, oneTimeTotal: sum(oneTime), unit, hasRecurring: recurring.length > 0, discounted: pct.some((p) => p.percentage < 0) };
    }

    async function offerCard(o) {
        let prices = [];
        try {
            prices = await pricesFor(o.id);
        } catch (err) {
            toast(errorText(err), 'error');
        }
        const s = priceSummary(prices);
        const overridden = prices.some((p) => p.priceResolution && p.priceResolution.source !== 'CATALOGUE_RATE');
        const priceBlock = prices.length
            ? h('div',
                  s.hasRecurring ? h('div.price-big', money(s.recurringTotal, s.unit), h('span.small.muted', ' / month')) : null,
                  s.oneTimeTotal ? h('div.muted', `+ ${money(s.oneTimeTotal, s.unit)} one-time`) : null,
                  overridden ? h('span.badge.approved', 'Personalised price') : null,
                  s.discounted ? h('span.badge.ok', 'Discount applied') : null)
            : h('div.muted', 'Not available in this market');
        return h('article.card.offer',
            h('div.card-head', h('h3', o.name), statusBadge(o.lifecycleStatus)),
            h('div.card-body.stack',
                h('div.small.muted', o.productSpecification.name, o.isBundle ? ' · bundle' : ''),
                priceBlock,
                o.productOfferingRelationship && o.productOfferingRelationship.length
                    ? h('div.small', o.productOfferingRelationship.map((r) => h('div', `${r.relationshipType} `, h('strong', r.name))))
                    : null,
                o.category && o.category.length ? h('div.chips', o.category.map((c) => h('span.chip', c.name))) : null),
            h('div.card-body', h('button.btn', { onclick: () => showDetail(o, prices) }, 'View TMF620 details')));
    }

    function showDetail(o, prices) {
        state.selected = { o, prices };
        renderDetail();
        document.getElementById('detail').scrollIntoView({ behavior: 'smooth' });
    }

    function renderDetail() {
        const host = document.getElementById('detail');
        if (!host) return;
        clear(host);
        if (!state.selected) return;
        const { o, prices } = state.selected;
        const lines = prices.map((p) =>
            h('div.price-line',
                h('div', h('strong', p.description), h('div.small.muted', `${p.priceType}${p.recurringChargePeriodType ? ' · per ' + (p.recurringChargePeriodLength > 1 ? p.recurringChargePeriodLength + ' ' : '') + p.recurringChargePeriodType : ''} · ${(p.place || []).map((x) => x.name).join(', ')}`)),
                h('div.right',
                    p.priceResolution && p.priceResolution.source !== 'CATALOGUE_RATE' && p.price
                        ? h('span.strike', money(p.priceResolution.catalogueValue, p.price.unit)) : null,
                    p.price ? h('strong', money(p.price.value, p.price.unit)) : h('strong', `${p.percentage}%`),
                    h('div.small.muted', p.priceResolution ? `resolved by ${p.priceResolution.source}` : ''))));
        host.append(
            h('section.card',
                h('div.card-head', h('h3', `${o.name} — TMF620 resources`), h('button.btn.small', { onclick: () => { state.selected = null; renderDetail(); } }, 'Close')),
                h('div.card-body.grid-2',
                    h('div.stack', h('h4', 'ProductOfferingPrice'), prices.length ? h('div', lines) : h('div.muted', 'No prices for this market.')),
                    h('div.stack', h('h4', 'ProductOffering JSON'), h('pre.json', JSON.stringify(o, null, 2))))));
    }

    async function renderPage() {
        const ctxForm = h('form.form-grid',
            h('div.field', h('label', 'Market'), (() => {
                const sel = h('select', { name: 'market' }, state.places.map((p) => {
                    const opt = h('option', { value: p.id }, p.name);
                    if (p.id === state.marketId) opt.selected = true;
                    return opt;
                }));
                return sel;
            })()),
            h('div.field', h('label', 'Subscriber id'), h('input', { name: 'subscriber', value: state.subscriberId, placeholder: 'e.g. SUB-NGA-001' })),
            h('div.field', h('label', 'Account id'), h('input', { name: 'account', value: state.accountId, placeholder: 'e.g. ACC-CORP-01' })),
            h('div.field', h('button.btn.primary', { type: 'submit' }, 'Show prices')));
        ctxForm.addEventListener('submit', (e) => {
            e.preventDefault();
            state.marketId = ctxForm.elements.market.value;
            store.set('viewer.marketId', state.marketId);
            state.subscriberId = ctxForm.elements.subscriber.value.trim();
            state.accountId = ctxForm.elements.account.value.trim();
            state.selected = null;
            renderPage();
        });

        const chips = h('div.chips',
            [{ id: '', name: 'All' }, ...state.categories].map((c) =>
                h(`button.chip${state.category === c.id ? '.active' : ''}`, { type: 'button', onclick: () => { state.category = c.id; renderPage(); } }, c.name)));

        const visible = state.offerings.filter((o) => !state.category || (o.category || []).some((c) => c.id === state.category || state.categories.find((x) => x.id === c.id && x.parentId === state.category)));
        const grid = h('div.offer-grid', h('div.muted', 'Loading prices…'));
        const catalog = state.catalogs[0];

        clear(view).append(
            h('div.page-head',
                h('div.grow',
                    h('h2', catalog ? catalog.name : 'Catalogue'),
                    h('div.small.muted', catalog ? ['Version ', h('strong', catalog.version || '—'), ' ', statusBadge(catalog.lifecycleStatus), ` · ${state.offerings.length} launched offering(s)`] : 'No published catalogue')),
                h('code.small.muted', state.lastRequest)),
            h('section.card', h('div.card-body.stack', ctxForm, state.categories.length ? chips : null)),
            grid,
            h('div', { id: 'detail' }));

        const cards = await Promise.all(visible.map(offerCard));
        clear(grid).append(...(cards.length ? cards : [h('div.card', h('div.empty', 'No launched offerings for this tenant.'))]));
        renderDetail();
    }

    async function start() {
        renderSessionBar();
        clear(view).append(h('div.muted', 'Loading catalogue…'));
        try {
            await load();
            await renderPage();
        } catch (err) {
            clear(view).append(h('div.callout.danger', h('strong', 'Could not load the catalogue. '), errorText(err)));
        }
    }

    start();
})();
