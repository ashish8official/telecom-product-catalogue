/* Catalogue admin console. Talks only to /api/internal. */
(function () {
    'use strict';
    const { h, clear, toast, request, errorText, money, date, statusBadge, formValues, field, select, session, SEED_TENANTS } = window.Catalogue;
    const API = '/api/internal';
    const view = document.getElementById('view');

    const api = {
        get: (p) => request('GET', API + p).then((r) => r.data),
        post: (p, b) => request('POST', API + p, b || {}).then((r) => r.data),
        put: (p, b) => request('PUT', API + p, b).then((r) => r.data),
        patch: (p, b) => request('PATCH', API + p, b).then((r) => r.data),
        del: (p) => request('DELETE', API + p).then((r) => r.data),
    };

    // ---- small UI building blocks ------------------------------------------------------------------

    function card(title, body, actions) {
        return h('section.card', h('div.card-head', h('h3', title), actions || null), body);
    }

    function table(columns, rows, opts = {}) {
        if (!rows.length) return h('div.empty', opts.empty || 'Nothing here yet.');
        return h(
            'div.table-wrap',
            h(
                'table',
                h('thead', h('tr', columns.map((c) => h(c.num ? 'th.num' : 'th', c.label)))),
                h(
                    'tbody',
                    rows.map((r) =>
                        h(
                            opts.onRow ? 'tr.clickable' : 'tr',
                            { onclick: opts.onRow ? () => opts.onRow(r) : undefined },
                            columns.map((c) => h(c.num ? 'td.num' : 'td', c.render ? c.render(r) : r[c.key] ?? '—'))
                        )
                    )
                )
            )
        );
    }

    /** A form whose submit runs `action(values)`, shows errors as toasts and then re-renders. */
    function form(controls, submitLabel, action, opts = {}) {
        const btn = h('button.btn.primary', { type: 'submit' }, submitLabel);
        const f = h('form.form-grid', { novalidate: true }, controls, h('div.field', btn));
        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            btn.disabled = true;
            try {
                await action(formValues(f), f);
                if (opts.success) toast(opts.success);
                if (opts.reset !== false) f.reset();
                await render();
            } catch (err) {
                toast(errorText(err), 'error');
            } finally {
                btn.disabled = false;
            }
        });
        return f;
    }

    async function act(fn, success) {
        try {
            await fn();
            if (success) toast(success);
            await render();
        } catch (err) {
            toast(errorText(err), 'error');
        }
    }

    function confirmAct(message, fn, success) {
        if (window.confirm(message)) return act(fn, success);
    }

    const input = (name, attrs = {}) => h('input', { name, ...attrs });
    const lockedNote = (status) =>
        h('div.callout.warn', `This version is ${status}. Its content is frozen; create a new version (clone) to make changes.`);

    function pageHead(title, crumbs, actions, sub) {
        return h(
            'div.page-head',
            h('div.grow', crumbs ? h('div.crumbs', crumbs) : null, h('h2', title), sub ? h('div.muted.small', sub) : null),
            actions ? h('div.row', actions) : null
        );
    }

    // ---- session bar -------------------------------------------------------------------------------

    function renderSessionBar() {
        const bar = clear(document.getElementById('session-bar'));
        const tenantSel = h('select', { 'aria-label': 'Tenant' });
        const known = [...SEED_TENANTS];
        if (!known.some((t) => t.id === session.tenantId())) known.push({ id: session.tenantId(), label: session.tenantId() });
        for (const t of known) {
            const o = h('option', { value: t.id }, t.label);
            if (t.id === session.tenantId()) o.selected = true;
            tenantSel.appendChild(o);
        }
        tenantSel.appendChild(h('option', { value: '__custom' }, 'Other tenant…'));
        tenantSel.addEventListener('change', () => {
            let v = tenantSel.value;
            if (v === '__custom') v = (window.prompt('Tenant UUID') || '').trim();
            if (v) session.setTenantId(v);
            renderSessionBar();
            render();
        });
        const keyBtn = h('button.btn.small', { type: 'button' }, session.apiKey() ? 'API key ✓' : 'Set API key');
        keyBtn.addEventListener('click', () => {
            const v = window.prompt('API key (leave empty to use the tenant header in development mode)', session.apiKey());
            if (v === null) return;
            session.setApiKey(v.trim());
            renderSessionBar();
            render();
        });
        bar.append(session.apiKey() ? h('span.small.muted', 'Tenant from API key') : tenantSel, keyBtn);
    }

    // ---- views ---------------------------------------------------------------------------------------

    async function cataloguesView() {
        const catalogues = await api.get('/catalogues');
        const versions = await api.get('/versions');
        const blocks = catalogues.map((c) => {
            const vs = versions.filter((v) => v.catalogue_id === c.id);
            const newVersion = form(
                [
                    field('New version label', input('version', { placeholder: 'e.g. v3', required: true })),
                    field('Start from', select('clone_from_version_id', vs.map((v) => ({ value: v.id, label: `Copy of ${v.version} (${v.status})` })), { placeholder: 'Empty version' })),
                ],
                'Create draft',
                (v) => api.post('/versions', { catalogue_id: c.id, ...v }),
                { success: 'Draft version created' }
            );
            return card(
                c.name,
                h(
                    'div',
                    c.description ? h('div.card-body.muted', c.description) : null,
                    h(
                        'div.card-body.flush',
                        table(
                            [
                                { label: 'Version', render: (v) => h('a', { href: `#/versions/${v.id}` }, h('strong', v.version)) },
                                { label: 'Status', render: (v) => statusBadge(v.status) },
                                { label: 'In force', render: (v) => (v.id === c.released_version_id ? h('span.badge.ok', 'Published') : '') },
                                { label: 'Offerings', key: 'offering_count', num: true },
                                { label: 'Valid from', render: (v) => date(v.valid_from) },
                                { label: 'Valid to', render: (v) => date(v.valid_to) },
                            ],
                            vs,
                            { onRow: (v) => (location.hash = `#/versions/${v.id}`), empty: 'No versions yet.' }
                        )
                    ),
                    h('div.card-body', newVersion)
                ),
                h('span.small.muted', `${c.version_count} version(s)`)
            );
        });

        const newCatalogue = form(
            [field('Name', input('name', { required: true })), field('Description', input('description'))],
            'Create catalogue',
            (v) => api.post('/catalogues', v),
            { success: 'Catalogue created' }
        );
        return [
            pageHead('Catalogues & versions', null, null, 'Versions move DRAFT → APPROVED → RELEASED → RETIRED. Content freezes at approval.'),
            h('div.stack', blocks.length ? blocks : h('div.card', h('div.empty', 'No catalogues for this tenant.')), card('New catalogue', h('div.card-body', newCatalogue))),
        ];
    }

    async function versionView(id) {
        const [version, offerings, specs] = await Promise.all([api.get(`/versions/${id}`), api.get(`/versions/${id}/offerings`), api.get('/product-specifications')]);
        const draft = version.status === 'DRAFT';
        const transitions = { DRAFT: ['APPROVED', 'RETIRED'], APPROVED: ['RELEASED', 'RETIRED'], RELEASED: ['RETIRED'], RETIRED: [] }[version.status];
        const labels = { APPROVED: 'Approve', RELEASED: 'Release', RETIRED: 'Retire' };
        const actions = transitions.map((s) =>
            h(
                `button.btn${s === 'RETIRED' ? '.danger' : '.primary'}`,
                { onclick: () => confirmAct(`${labels[s]} version ${version.version}?`, () => api.post(`/versions/${id}/transition`, { status: s }), `Version ${labels[s].toLowerCase()}d`) },
                labels[s]
            )
        );
        if (draft) {
            actions.push(
                h('button.btn.danger', {
                    onclick: () => confirmAct(`Delete draft ${version.version} and all its offerings?`, async () => {
                        await api.del(`/versions/${id}`);
                        location.hash = '#/catalogues';
                    }, 'Draft deleted'),
                }, 'Delete draft')
            );
        }

        const list = table(
            [
                { label: 'Offering', render: (o) => h('div', h('a', { href: `#/offerings/${o.id}` }, h('strong', o.offering_name)), h('div.small.muted.mono', o.offering_code)) },
                { label: 'Type', key: 'offering_type' },
                { label: 'Payment', key: 'service_type' },
                { label: 'Specification', key: 'spec_name' },
                { label: 'Charges', render: (o) => o.charges.length, num: true },
                { label: 'Rates', render: (o) => o.rates.length, num: true },
                { label: 'Restrictions', render: (o) => o.markets.map((m) => `${m.restriction} ${m.market_code}`).join(', ') || '—' },
            ],
            offerings,
            { onRow: (o) => (location.hash = `#/offerings/${o.id}`), empty: 'No offerings in this version.' }
        );

        const addOffering = draft
            ? card(
                  'Add offering',
                  h(
                      'div.card-body',
                      form(
                          [
                              field('Name', input('offering_name', { required: true })),
                              field('Code (optional)', input('offering_code', { placeholder: 'derived from name' })),
                              field('Product specification', select('product_specification_id', specs.map((s) => ({ value: s.id, label: s.spec_name })), { required: true })),
                              field('Type', select('offering_type', ['BASE', 'ADDON', 'BUNDLE', 'STANDALONE'].map((v) => ({ value: v, label: v })))),
                              field('Payment', select('service_type', ['BOTH', 'PREPAID', 'POSTPAID'].map((v) => ({ value: v, label: v })))),
                          ],
                          'Add offering',
                          async (v) => {
                              const created = await api.post('/offerings', { catalogue_version_id: id, ...v });
                              location.hash = `#/offerings/${created.id}`;
                          },
                          { success: 'Offering created' }
                      )
                  )
              )
            : null;

        let readiness = null;
        if (version.status === 'DRAFT' || version.status === 'APPROVED') {
            readiness = h('div.callout', 'Approval and release check that every offering has charges and every charge has at least one rate.');
        }

        return [
            pageHead(
                `${version.catalogue_name} · ${version.version}`,
                h('span', h('a', { href: '#/catalogues' }, 'Catalogues'), ' / ', version.version),
                actions,
                h('span', statusBadge(version.status), ` Valid ${date(version.valid_from)} → ${version.valid_to ? date(version.valid_to) : 'open-ended'}`)
            ),
            h('div.stack', !draft ? lockedNote(version.status) : readiness, card(`Offerings (${offerings.length})`, h('div.card-body.flush', list)), addOffering),
        ];
    }

    async function offeringView(id) {
        const o = await api.get(`/offerings/${id}`);
        const [charges, services, markets, rules, categories, siblings, currencies] = await Promise.all([
            api.get('/charge-specifications'),
            api.get('/service-specifications'),
            api.get('/markets'),
            api.get('/policy-rules'),
            api.get('/categories'),
            api.get(`/versions/${o.catalogue_version_id}/offerings`),
            api.get('/currencies'),
        ]);
        const draft = o.version_status === 'DRAFT';
        const marketOpts = markets.map((m) => ({ value: m.id, label: `${m.market_code} · ${m.market_name}${m.is_pricing_market ? '' : ' (group)'}` }));
        const pricingMarkets = markets.filter((m) => m.is_pricing_market).map((m) => ({ value: m.id, label: `${m.market_code} · ${m.market_name}` }));
        const removeBtn = (label, fn) => (draft ? h('button.btn.small.danger', { onclick: () => confirmAct(`Remove ${label}?`, fn, 'Removed') }, 'Remove') : null);

        // Details
        const details = h(
            'div.card-body',
            h('dl.kv',
                h('dt', 'Code'), h('dd.mono', o.offering_code),
                h('dt', 'Specification'), h('dd', o.spec_name),
                h('dt', 'Version'), h('dd', h('a', { href: `#/versions/${o.catalogue_version_id}` }, `${o.catalogue_name} · ${o.version}`), ' ', statusBadge(o.version_status))
            ),
            draft
                ? h('div', h('hr'), form(
                      [
                          field('Name', input('offering_name', { value: o.offering_name })),
                          field('Type', select('offering_type', ['BASE', 'ADDON', 'BUNDLE', 'STANDALONE'].map((v) => ({ value: v, label: v })), { value: o.offering_type })),
                          field('Payment', select('service_type', ['BOTH', 'PREPAID', 'POSTPAID'].map((v) => ({ value: v, label: v })), { value: o.service_type })),
                      ],
                      'Save',
                      (v) => api.patch(`/offerings/${id}`, v),
                      { success: 'Offering saved', reset: false }
                  ))
                : null
        );

        // Charges and rates
        const attached = new Set(o.charges.map((c) => c.charge_spec_id));
        const chargeTable = table(
            [
                { label: 'Priority', key: 'charge_priority', num: true },
                { label: 'Charge', render: (c) => h('div', h('strong', c.charge_name), h('div.small.muted.mono', c.charge_code)) },
                { label: 'Kind', render: (c) => `${c.charge_type}${c.charge_period ? ' / ' + c.charge_period : ''}` },
                { label: 'Calc', render: (c) => `${c.calculation_type} · ${c.stacking_rule}` },
                { label: '', render: (c) => removeBtn(c.charge_code, () => api.del(`/offerings/${id}/charges/${c.charge_spec_id}`)) },
            ],
            o.charges,
            { empty: 'No charges attached.' }
        );
        const addCharge = draft
            ? form(
                  [field('Attach charge', select('charge_spec_id', charges.filter((c) => !attached.has(c.id)).map((c) => ({ value: c.id, label: `${c.charge_code} · ${c.charge_name}` })), { required: true }))],
                  'Attach',
                  (v) => api.post(`/offerings/${id}/charges`, v),
                  { success: 'Charge attached' }
              )
            : null;

        const overridesHost = h('div');
        const rateTable = table(
            [
                { label: 'Charge', key: 'charge_code' },
                { label: 'Market', render: (r) => `${r.market_code} · ${r.market_name}` },
                { label: 'Amount', render: (r) => money(r.amount, r.currency_code), num: true },
                { label: 'Overrides', render: (r) => h('button.btn.small', { onclick: () => showOverrides(r, overridesHost) }, `${r.override_count} · manage`) },
                { label: '', render: (r) => removeBtn(`rate ${r.charge_code}/${r.market_code}`, () => api.del(`/offerings/${id}/rates/${r.id}`)) },
            ],
            o.rates,
            { empty: 'No rates yet. A market without its own rate inherits its nearest parent market\'s rate.' }
        );
        const addRate = draft && o.charges.length
            ? form(
                  [
                      field('Charge', select('charge_spec_id', o.charges.map((c) => ({ value: c.charge_spec_id, label: c.charge_code })), { required: true })),
                      field('Market', select('market_id', pricingMarkets, { required: true })),
                      field('Amount', input('amount', { required: true, inputmode: 'decimal', placeholder: 'e.g. 1299.00 or -10 for −10%' })),
                      field('Currency', select('currency_code', currencies.map((c) => ({ value: c.currency_code, label: c.currency_code })), { placeholder: 'Market default' })),
                  ],
                  'Set rate',
                  (v) => api.put(`/offerings/${id}/rates`, v),
                  { success: 'Rate saved' }
              )
            : null;

        // Services
        const svcTable = table(
            [
                { label: 'Service', render: (s) => h('div', h('strong', s.spec_name), h('div.small.muted.mono', s.spec_code)) },
                { label: 'Mandatory', render: (s) => (s.mandatory_flag ? 'Yes' : 'No') },
                { label: 'Qty', render: (s) => `${s.min_qty}–${s.max_qty}` },
                { label: '', render: (s) => removeBtn(s.spec_code, () => api.del(`/offerings/${id}/services/${s.service_spec_id}`)) },
            ],
            o.services,
            { empty: 'No provisioning services.' }
        );
        const addSvc = draft
            ? form(
                  [
                      field('Service', select('service_spec_id', services.map((s) => ({ value: s.id, label: s.spec_name })), { required: true })),
                      field('Min', input('min_qty', { type: 'number', min: 0, value: 1, dataset: { type: 'number' } })),
                      field('Max', input('max_qty', { type: 'number', min: 0, value: 1, dataset: { type: 'number' } })),
                      field('', h('label.check', input('mandatory_flag', { type: 'checkbox', checked: true }), 'Mandatory')),
                  ],
                  'Add service',
                  (v) => api.put(`/offerings/${id}/services`, v),
                  { success: 'Service saved' }
              )
            : null;

        // Market restrictions
        const mktTable = table(
            [
                { label: 'Market', render: (m) => `${m.market_code} · ${m.market_name}` },
                { label: 'Rule', render: (m) => h(`span.badge${m.restriction === 'EXCLUDE' ? '.danger' : '.ok'}`, m.restriction) },
                { label: '', render: (m) => removeBtn(m.market_code, () => api.del(`/offerings/${id}/markets/${m.market_id}`)) },
            ],
            o.markets,
            { empty: 'Sellable in every market (no restrictions).' }
        );
        const addMkt = draft
            ? form(
                  [
                      field('Market', select('market_id', marketOpts, { required: true })),
                      field('Rule', select('restriction', [{ value: 'EXCLUDE', label: 'EXCLUDE (and its children)' }, { value: 'INCLUDE', label: 'INCLUDE (carve-out under an excluded parent)' }])),
                  ],
                  'Apply',
                  (v) => api.put(`/offerings/${id}/markets`, v),
                  { success: 'Restriction saved' }
              )
            : null;

        // Relationships
        const relTable = table(
            [
                { label: 'Type', key: 'relationship_type' },
                { label: 'Target', render: (r) => h('a', { href: `#/offerings/${r.target_offering_id}` }, r.target_name) },
                { label: '', render: (r) => removeBtn(`${r.relationship_type} ${r.target_code}`, () => api.del(`/offerings/${id}/relationships/${r.id}`)) },
            ],
            o.relationships,
            { empty: 'No relationships.' }
        );
        const addRel = draft
            ? form(
                  [
                      field('Type', select('relationship_type', ['REQUIRES', 'EXCLUDES', 'UPGRADE'].map((v) => ({ value: v, label: v })))),
                      field('Target offering', select('target_offering_id', siblings.filter((s) => s.id !== id).map((s) => ({ value: s.id, label: s.offering_name })), { required: true })),
                  ],
                  'Add',
                  (v) => api.post(`/offerings/${id}/relationships`, v),
                  { success: 'Relationship added' }
              )
            : null;

        // Policies & categories
        const polTable = table(
            [
                { label: 'Schema', render: (p) => `${p.schema_name} v${p.schema_version}` },
                { label: 'Rule', render: (p) => h('code', JSON.stringify(p.rule_json)) },
                { label: '', render: (p) => removeBtn('policy', () => api.del(`/offerings/${id}/policies/${p.policy_rule_id}`)) },
            ],
            o.policies,
            { empty: 'No eligibility policies (everyone is eligible).' }
        );
        const addPol = draft
            ? form(
                  [field('Policy rule', select('policy_rule_id', rules.map((r) => ({ value: r.id, label: JSON.stringify(r.rule_json) })), { required: true }))],
                  'Attach',
                  (v) => api.post(`/offerings/${id}/policies`, v),
                  { success: 'Policy attached' }
              )
            : null;
        const catChips = h(
            'div.chips',
            o.categories.length
                ? o.categories.map((c) => h('span.chip', c.name, ' ', h('button.btn.link.small', { 'aria-label': `Remove ${c.name}`, onclick: () => act(() => api.del(`/offerings/${id}/categories/${c.category_id}`), 'Category removed') }, '×')))
                : h('span.muted', 'Uncategorised')
        );
        const addCat = form(
            [field('Add category', select('category_id', categories.map((c) => ({ value: c.id, label: c.name })), { required: true }))],
            'Add',
            (v) => api.post(`/offerings/${id}/categories`, v),
            { success: 'Category added' }
        );

        return [
            pageHead(
                o.offering_name,
                h('span', h('a', { href: '#/catalogues' }, 'Catalogues'), ' / ', h('a', { href: `#/versions/${o.catalogue_version_id}` }, o.version), ' / ', o.offering_code),
                [
                    h('a.btn', { href: `#/simulator?offering=${id}` }, 'Simulate price'),
                    draft ? h('button.btn.danger', { onclick: () => confirmAct(`Delete ${o.offering_name}?`, async () => { await api.del(`/offerings/${id}`); location.hash = `#/versions/${o.catalogue_version_id}`; }, 'Offering deleted') }, 'Delete') : null,
                ],
                `${o.offering_type} · ${o.service_type}`
            ),
            h(
                'div.stack',
                draft ? null : lockedNote(o.version_status),
                h('div.grid-2', card('Details', details), card('Eligibility policies', h('div', h('div.card-body.flush', polTable), addPol ? h('div.card-body', addPol) : null))),
                card('Charges', h('div', h('div.card-body.flush', chargeTable), addCharge ? h('div.card-body', addCharge) : null)),
                card('Rates', h('div', h('div.card-body.flush', rateTable), addRate ? h('div.card-body', addRate) : null, overridesHost)),
                h('div.grid-2',
                    card('Market restrictions', h('div', h('div.card-body.flush', mktTable), addMkt ? h('div.card-body', addMkt) : null)),
                    card('Relationships', h('div', h('div.card-body.flush', relTable), addRel ? h('div.card-body', addRel) : null))),
                h('div.grid-2',
                    card('Provisioning services', h('div', h('div.card-body.flush', svcTable), addSvc ? h('div.card-body', addSvc) : null)),
                    card('Categories (presentation only)', h('div.card-body.stack', catChips, addCat)))
            ),
        ];
    }

    async function showOverrides(rate, host) {
        const list = await api.get(`/rates/${rate.id}/overrides`);
        const now = Date.now();
        const state = (o) => {
            const from = new Date(o.effective_from).getTime();
            const to = o.effective_to ? new Date(o.effective_to).getTime() : Infinity;
            return from > now ? h('span.badge.approved', 'Scheduled') : to <= now ? h('span.badge.retired', 'Ended') : h('span.badge.ok', 'Active');
        };
        const tbl = table(
            [
                { label: 'Scope', key: 'scope_type' },
                { label: 'Reference', render: (o) => h('code', o.scope_reference_id) },
                { label: 'Amount', render: (o) => money(o.override_amount, rate.currency_code), num: true },
                { label: 'From', render: (o) => date(o.effective_from) },
                { label: 'To', render: (o) => (o.effective_to ? date(o.effective_to) : 'open') },
                { label: 'State', render: state },
                { label: '', render: (o) => (o.effective_to && new Date(o.effective_to).getTime() <= now ? null : h('button.btn.small', { onclick: () => act(async () => { await api.post(`/overrides/${o.id}/end`, {}); await showOverrides(rate, host); }, 'Override ended') }, 'End now')) },
            ],
            list,
            { empty: 'No overrides on this rate.' }
        );
        const addForm = form(
            [
                field('Scope', select('scope_type', ['SUBSCRIBER', 'ACCOUNT', 'MARKET'].map((v) => ({ value: v, label: v })))),
                field('Reference (subscriber/account id, or market UUID)', input('scope_reference_id', { required: true })),
                field('Amount', input('override_amount', { required: true, inputmode: 'decimal' })),
                field('From', input('effective_from', { type: 'datetime-local', required: true, dataset: { type: 'datetime' } })),
                field('To (optional)', input('effective_to', { type: 'datetime-local', dataset: { type: 'datetime' } })),
            ],
            'Add override',
            async (v) => {
                await api.post(`/rates/${rate.id}/overrides`, v);
            },
            { success: 'Override added' }
        );
        clear(host).appendChild(
            h('div.card-body.stack',
                h('div.row', h('h3', `Overrides for ${rate.charge_code} in ${rate.market_code}`), h('span.muted.small', `Catalogue rate ${money(rate.amount, rate.currency_code)} is never changed by overrides. Precedence: subscriber › account › market › catalogue.`)),
                tbl,
                addForm)
        );
        host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    async function simulatorView(params) {
        const [versions, markets] = await Promise.all([api.get('/versions'), api.get('/markets')]);
        const offeringLists = await Promise.all(versions.map((v) => api.get(`/versions/${v.id}/offerings`).then((os) => os.map((o) => ({ o, v })))));
        const options = offeringLists.flat().map(({ o, v }) => ({ value: o.id, label: `${o.offering_name} — ${v.catalogue_name} ${v.version} (${v.status})` }));
        const out = h('div');

        const f = h('form.form-grid',
            field('Offering', select('offering_id', options, { required: true, value: params.get('offering') || undefined })),
            field('Market', select('market_id', markets.map((m) => ({ value: m.id, label: `${m.market_code} · ${m.market_name}` })), { required: true })),
            field('Subscriber id', input('subscriber_id', { placeholder: 'e.g. SUB-NGA-001' })),
            field('Account id', input('account_id', { placeholder: 'e.g. ACC-CORP-01' })),
            field('Effective at', input('effective_at', { type: 'datetime-local', dataset: { type: 'datetime' } })),
            field('Customer context (JSON)', h('textarea', { name: 'context', dataset: { type: 'json' } }, '{"account_category": "CORPORATE"}'), { wide: true }),
            h('div.field', h('button.btn.primary', { type: 'submit' }, 'Resolve price'))
        );
        f.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                const q = await api.post('/quote', formValues(f));
                clear(out).appendChild(renderQuote(q));
            } catch (err) {
                toast(errorText(err), 'error');
            }
        });

        return [
            pageHead('Price simulator', null, null, 'Runs the full resolution engine: market eligibility, policy, charge stacking, rate by market hierarchy, overrides, tax and GL.'),
            h('div.stack', card('Context', h('div.card-body', f)), out),
        ];
    }

    function renderQuote(q) {
        const verdict = q.sellable
            ? h('div.callout.ok', `Sellable in ${q.market.name}.`)
            : h('div.callout.danger', 'Not sellable: ',
                  !q.eligibility.allowed ? `excluded in this market (${q.eligibility.reason}). ` : '',
                  !q.policy.passed ? 'eligibility policy failed. ' : '',
                  q.lines.some((l) => l.status !== 'PRICED') ? 'some charges have no rate.' : '');
        const lines = table(
            [
                { label: '#', key: 'priority', num: true },
                { label: 'Charge', render: (l) => h('div', h('strong', l.charge_name), h('div.small.muted', `${l.charge_type}${l.charge_period ? ' / ' + l.charge_period : ''} · ${l.calculation_type}`)) },
                { label: 'Catalogue', render: (l) => (l.catalogue_amount === null ? '—' : l.calculation_type === 'PERCENTAGE' ? `${Number(l.catalogue_amount)}%` : money(l.catalogue_amount, l.currency_code)), num: true },
                { label: 'Resolved by', render: (l) => (l.resolution_source ? h(`span.badge${l.resolution_source === 'CATALOGUE_RATE' ? '' : '.approved'}`, l.resolution_source) : h('span.badge.danger', 'NO RATE')) },
                { label: 'Net', render: (l) => money(l.net_amount, l.currency_code), num: true },
                { label: 'Tax', render: (l) => h('div', money(l.tax_amount, l.currency_code), h('div.small.muted', l.taxes.map((t) => `${t.tax_name} ${t.tax_rate}% (${t.fallback_level})`).join(', '))), num: true },
                { label: 'Gross', render: (l) => h('strong', money(l.gross_amount, l.currency_code)), num: true },
                { label: 'GL', render: (l) => l.journals.map((j) => j.gl_code).join(', ') || '—' },
            ],
            q.lines,
            { empty: 'This offering has no charges.' }
        );
        const totals = table(
            [
                { label: 'Currency', key: 'currency_code' },
                { label: 'Charge type', render: (t) => `${t.charge_type}${t.charge_period ? ' / ' + t.charge_period : ''}` },
                { label: 'Net', render: (t) => money(t.net), num: true },
                { label: 'Tax', render: (t) => money(t.tax), num: true },
                { label: 'Gross', render: (t) => h('strong', money(t.gross)), num: true },
            ],
            q.totals
        );
        return h('div.stack',
            verdict,
            q.warnings.length ? h('div.callout.warn', 'Warnings', h('ul', q.warnings.map((w) => h('li', w)))) : null,
            card(`${q.offering.name} in ${q.market.name}`, h('div.card-body.flush', lines), h('span.small.muted', `as of ${date(q.effective_at)}`)),
            card('Totals', h('div.card-body.flush', totals)),
            h('div.grid-2',
                card('Policy evaluation', h('div.card-body', h('pre.json', JSON.stringify(q.policy, null, 2)))),
                card('Relationships to check at order time', h('div.card-body', q.relationships.length ? h('ul', q.relationships.map((r) => h('li', `${r.type} ${r.target_code}`))) : h('span.muted', 'None'))))
        );
    }

    async function specificationsView() {
        const [products, charges, services, financials] = await Promise.all([
            api.get('/product-specifications'),
            api.get('/charge-specifications'),
            api.get('/service-specifications'),
            api.get('/charge-financials'),
        ]);
        return [
            pageHead('Specifications', null, null, 'Tenant-level definitions. Once a released version uses one, its defining fields are frozen.'),
            h('div.stack',
                card('Product specifications', h('div',
                    h('div.card-body.flush', table([
                        { label: 'Code', render: (s) => h('code', s.spec_code) },
                        { label: 'Name', key: 'spec_name' },
                        { label: 'Status', render: (s) => statusBadge(s.status) },
                        { label: 'Valid from', render: (s) => date(s.effective_from) },
                    ], products)),
                    h('div.card-body', form([
                        field('Code', input('spec_code', { required: true, placeholder: 'M2M_CONNECTIVITY' })),
                        field('Name', input('spec_name', { required: true })),
                    ], 'Add', (v) => api.post('/product-specifications', v), { success: 'Product specification created' })))),
                card('Charge specifications', h('div',
                    h('div.card-body.flush', table([
                        { label: 'Priority', key: 'charge_priority', num: true },
                        { label: 'Code', render: (c) => h('code', c.charge_code) },
                        { label: 'Name', key: 'charge_name' },
                        { label: 'Kind', render: (c) => `${c.charge_type}${c.charge_period ? ' / ' + c.charge_period : ''}` },
                        { label: 'Calculation', render: (c) => `${c.calculation_type} · ${c.stacking_rule}` },
                        { label: 'Tax', render: (c) => financials.taxes.filter((t) => t.charge_specification_id === c.id).map((t) => t.tax_name).join(', ') || '—' },
                        { label: 'GL', render: (c) => financials.journals.filter((j) => j.charge_specification_id === c.id).map((j) => j.gl_code).join(', ') || '—' },
                    ], charges)),
                    h('div.card-body', form([
                        field('Code', input('charge_code', { required: true, placeholder: 'RC_MONTHLY' })),
                        field('Name', input('charge_name', { required: true })),
                        field('Priority', input('charge_priority', { type: 'number', value: 100, dataset: { type: 'number' } })),
                        field('Type', select('charge_type', ['RECURRING', 'ONE_TIME', 'USAGE'].map((v) => ({ value: v, label: v })))),
                        field('Period (recurring only)', select('charge_period', ['MONTH', 'DAY', 'WEEK', 'QUARTER', 'YEAR'].map((v) => ({ value: v, label: v })), { placeholder: '—' })),
                        field('Calculation', select('calculation_type', [{ value: 'FLAT', label: 'FLAT amount' }, { value: 'PERCENTAGE', label: 'PERCENTAGE of preceding charges' }])),
                        field('Stacking', select('stacking_rule', [{ value: 'ADDITIVE', label: 'ADDITIVE' }, { value: 'OVERRIDE', label: 'OVERRIDE (replaces lower-priority charges)' }])),
                    ], 'Add', (v) => api.post('/charge-specifications', v), { success: 'Charge specification created' })))),
                card('Service specifications (provisioning)', h('div',
                    h('div.card-body.flush', table([
                        { label: 'Code', render: (s) => h('code', s.spec_code) },
                        { label: 'Name', key: 'spec_name' },
                        { label: 'Characteristics', render: (s) => (s.characteristics ? h('code', JSON.stringify(s.characteristics)) : '—') },
                    ], services)),
                    h('div.card-body', form([
                        field('Code', input('spec_code', { required: true })),
                        field('Name', input('spec_name', { required: true })),
                        field('Characteristics (JSON)', h('textarea', { name: 'characteristics', dataset: { type: 'json' } }), { wide: true }),
                    ], 'Add', (v) => api.post('/service-specifications', v), { success: 'Service specification created' }))))
            ),
        ];
    }

    async function marketsView() {
        const [markets, currencies] = await Promise.all([api.get('/markets'), api.get('/currencies')]);
        const byParent = new Map();
        for (const m of markets) {
            const k = m.parent_market_id || 'root';
            if (!byParent.has(k)) byParent.set(k, []);
            byParent.get(k).push(m);
        }
        const tree = (parent) =>
            h('ul.tree', (byParent.get(parent) || []).map((m) =>
                h('li',
                    h('strong', m.market_code), ' ', m.market_name, ' ',
                    h('span.badge', m.market_type), ' ',
                    m.is_pricing_market ? null : h('span.badge.draft', 'not priced'), ' ',
                    h('span.small.muted', [m.timezone, m.default_currency_code].filter(Boolean).join(' · ')),
                    byParent.has(m.id) ? tree(m.id) : null)));
        const opts = markets.map((m) => ({ value: m.id, label: `${m.market_code} · ${m.market_name}` }));
        return [
            pageHead('Markets & currencies', null, null, 'Markets nest to any depth. Rates, overrides, taxes and restrictions all follow the hierarchy (nearest market wins).'),
            h('div.grid-2',
                card('Market hierarchy', h('div.card-body', markets.length ? tree('root') : h('div.empty', 'No markets.'))),
                h('div.stack',
                    card('New market', h('div.card-body', form([
                        field('Code', input('market_code', { required: true })),
                        field('Name', input('market_name', { required: true })),
                        field('Parent', select('parent_market_id', opts, { placeholder: '(top level)' })),
                        field('Type', select('market_type', ['COUNTRY', 'GROUP', 'REGION', 'CITY', 'ZONE'].map((v) => ({ value: v, label: v })))),
                        field('IANA time zone', input('timezone', { placeholder: 'Africa/Lagos' })),
                        field('Currency', select('default_currency_code', currencies.map((c) => ({ value: c.currency_code, label: `${c.currency_code} · ${c.currency_name}` })), { placeholder: '—' })),
                        field('', h('label.check', input('is_pricing_market', { type: 'checkbox', checked: true }), 'Pricing market')),
                    ], 'Create market', (v) => api.post('/markets', v), { success: 'Market created' }))),
                    card('Move market', h('div.card-body', form([
                        field('Market', h('select', { name: '_id', required: true }, opts.map((o) => h('option', { value: o.value }, o.label)))),
                        field('New parent', select('parent_market_id', opts, { placeholder: '(top level)' })),
                    ], 'Move', (v) => api.patch(`/markets/${v._id}`, { parent_market_id: v.parent_market_id || null }), { success: 'Market moved' }))),
                    card('Currencies (ISO 4217)', h('div.card-body.stack',
                        h('div.chips', currencies.map((c) => h('span.chip', `${c.currency_code} · ${c.currency_name}`))),
                        form([
                            field('Code', input('code', { required: true, maxlength: 3, placeholder: 'EUR' })),
                            field('Name', input('currency_name', { required: true })),
                        ], 'Add currency', (v) => api.put(`/currencies/${v.code.toUpperCase()}`, { currency_name: v.currency_name }), { success: 'Currency saved' }))))
            ),
        ];
    }

    async function policiesView() {
        const [schemas, rules] = await Promise.all([api.get('/policy-schemas'), api.get('/policy-rules')]);
        const schemaName = (id) => {
            const s = schemas.find((x) => x.id === id);
            return s ? `${s.schema_name} v${s.version}` : id;
        };
        return [
            pageHead('Policies', null, null, 'Every rule is validated against its JSON Schema before it is stored. Schemas with rules bound to them are frozen; add a new version instead.'),
            h('div.grid-2',
                card('Schemas', h('div',
                    h('div.card-body.flush', table([
                        { label: 'Name', key: 'schema_name' },
                        { label: 'Version', key: 'version' },
                        { label: 'Schema', render: (s) => h('code', JSON.stringify(s.schema_json)) },
                    ], schemas)),
                    h('div.card-body', form([
                        field('Name', input('schema_name', { required: true })),
                        field('Version', input('version', { required: true, placeholder: '1.0' })),
                        field('JSON Schema', h('textarea', { name: 'schema_json', dataset: { type: 'json' }, required: true }, '{"type": "object", "properties": {}}'), { wide: true }),
                    ], 'Add schema', (v) => api.post('/policy-schemas', v), { success: 'Schema created' })))),
                card('Rules', h('div',
                    h('div.card-body.flush', table([
                        { label: 'Schema', render: (r) => schemaName(r.schema_id) },
                        { label: 'Rule', render: (r) => h('code', JSON.stringify(r.rule_json)) },
                    ], rules)),
                    h('div.card-body', form([
                        field('Schema', select('schema_id', schemas.map((s) => ({ value: s.id, label: `${s.schema_name} v${s.version}` })), { required: true })),
                        field('Rule JSON', h('textarea', { name: 'rule_json', dataset: { type: 'json' }, required: true }, '{}'), { wide: true }),
                    ], 'Add rule', (v) => api.post('/policy-rules', v), { success: 'Rule created' }))))
            ),
        ];
    }

    async function financeView() {
        const [taxes, journals, charges, markets, fin] = await Promise.all([
            api.get('/tax-configurations'),
            api.get('/journal-configurations'),
            api.get('/charge-specifications'),
            api.get('/markets'),
            api.get('/charge-financials'),
        ]);
        const mname = (id) => (id ? (markets.find((m) => m.id === id) || {}).market_code || id : 'All markets');
        const chargeOpts = charges.map((c) => ({ value: c.id, label: c.charge_code }));
        const cname = (id) => (charges.find((c) => c.id === id) || {}).charge_code || id;
        return [
            pageHead('Tax & GL', null, null, 'A tax set on a market applies to every market beneath it; a tax with no market applies everywhere.'),
            h('div.grid-2',
                card('Tax configurations', h('div',
                    h('div.card-body.flush', table([
                        { label: 'Tax', key: 'tax_name' },
                        { label: 'Rate', render: (t) => `${Number(t.tax_rate)}%`, num: true },
                        { label: 'Market', render: (t) => mname(t.market_master_id) },
                    ], taxes)),
                    h('div.card-body', form([
                        field('Name', input('tax_name', { required: true })),
                        field('Rate %', input('tax_rate', { required: true, inputmode: 'decimal' })),
                        field('Market', select('market_master_id', markets.map((m) => ({ value: m.id, label: m.market_code })), { placeholder: 'All markets' })),
                    ], 'Add tax', (v) => api.post('/tax-configurations', v), { success: 'Tax created' })))),
                card('GL accounts', h('div',
                    h('div.card-body.flush', table([
                        { label: 'GL code', render: (j) => h('code', j.gl_code) },
                        { label: 'Description', key: 'gl_description' },
                    ], journals)),
                    h('div.card-body', form([
                        field('GL code', input('gl_code', { required: true })),
                        field('Description', input('gl_description')),
                    ], 'Add GL account', (v) => api.post('/journal-configurations', v), { success: 'GL account created' })))),
                card('Tax mappings', h('div',
                    h('div.card-body.flush', table([
                        { label: 'Charge', render: (m) => cname(m.charge_specification_id) },
                        { label: 'Tax', key: 'tax_name' },
                        { label: '', render: (m) => h('button.btn.small.danger', { onclick: () => confirmAct('Remove tax mapping?', () => api.del(`/charge-specifications/${m.charge_specification_id}/taxes/${m.tax_configuration_id}`), 'Removed') }, 'Remove') },
                    ], fin.taxes)),
                    h('div.card-body', form([
                        field('Charge', select('_charge', chargeOpts, { required: true })),
                        field('Tax', select('tax_configuration_id', taxes.map((t) => ({ value: t.id, label: t.tax_name })), { required: true })),
                    ], 'Map', (v) => api.post(`/charge-specifications/${v._charge}/taxes`, { tax_configuration_id: v.tax_configuration_id }), { success: 'Tax mapped' })))),
                card('GL mappings', h('div',
                    h('div.card-body.flush', table([
                        { label: 'Charge', render: (m) => cname(m.charge_specification_id) },
                        { label: 'GL', render: (m) => h('code', m.gl_code) },
                        { label: '', render: (m) => h('button.btn.small.danger', { onclick: () => confirmAct('Remove GL mapping?', () => api.del(`/charge-specifications/${m.charge_specification_id}/journals/${m.journal_configuration_id}`), 'Removed') }, 'Remove') },
                    ], fin.journals)),
                    h('div.card-body', form([
                        field('Charge', select('_charge', chargeOpts, { required: true })),
                        field('GL account', select('journal_configuration_id', journals.map((j) => ({ value: j.id, label: j.gl_code })), { required: true })),
                    ], 'Map', (v) => api.post(`/charge-specifications/${v._charge}/journals`, { journal_configuration_id: v.journal_configuration_id }), { success: 'GL mapped' }))))
            ),
        ];
    }

    async function categoriesView() {
        const cats = await api.get('/categories');
        const name = (id) => (cats.find((c) => c.id === id) || {}).name;
        return [
            pageHead('Categories', null, null, 'Presentation only: categories never affect pricing, billing, provisioning or eligibility.'),
            card('Categories', h('div',
                h('div.card-body.flush', table([
                    { label: 'Name', key: 'name' },
                    { label: 'Parent', render: (c) => name(c.parent_category_id) || '—' },
                ], cats)),
                h('div.card-body', form([
                    field('Name', input('name', { required: true })),
                    field('Parent', select('parent_category_id', cats.map((c) => ({ value: c.id, label: c.name })), { placeholder: '(top level)' })),
                ], 'Add category', (v) => api.post('/categories', v), { success: 'Category created' })))),
        ];
    }

    // ---- router ----------------------------------------------------------------------------------------

    const routes = [
        [/^#\/catalogues$/, () => cataloguesView(), 'catalogues'],
        [/^#\/versions\/([\w-]+)$/, (m) => versionView(m[1]), 'catalogues'],
        [/^#\/offerings\/([\w-]+)$/, (m) => offeringView(m[1]), 'catalogues'],
        [/^#\/simulator(?:\?(.*))?$/, (m) => simulatorView(new URLSearchParams(m[1] || '')), 'simulator'],
        [/^#\/specifications$/, () => specificationsView(), 'specifications'],
        [/^#\/markets$/, () => marketsView(), 'markets'],
        [/^#\/policies$/, () => policiesView(), 'policies'],
        [/^#\/finance$/, () => financeView(), 'finance'],
        [/^#\/categories$/, () => categoriesView(), 'categories'],
    ];

    let renderSeq = 0;
    async function render() {
        const seq = ++renderSeq;
        const hash = location.hash || '#/catalogues';
        const route = routes.find(([re]) => re.test(hash));
        if (!route) {
            location.hash = '#/catalogues';
            return;
        }
        for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.route === route[2]);
        const scrollY = window.scrollY;
        try {
            const content = await route[1](hash.match(route[0]));
            if (seq !== renderSeq) return;
            clear(view).append(...[].concat(content));
            window.scrollTo(0, scrollY);
        } catch (err) {
            if (seq !== renderSeq) return;
            clear(view).append(
                h('div.callout.danger', h('strong', 'Could not load this page. '), errorText(err)),
                err.status === 400 || err.status === 401 || err.status === 403 ? h('p.muted', 'Check the tenant or API key in the top bar.') : null
            );
        }
    }

    let lastHash = location.hash;
    window.addEventListener('hashchange', () => {
        if (location.hash.split('?')[0] !== lastHash.split('?')[0]) window.scrollTo(0, 0);
        lastHash = location.hash;
        render();
    });
    renderSessionBar();
    render();
})();
