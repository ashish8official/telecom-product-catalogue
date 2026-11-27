/* Tiny helpers shared by the admin and the viewer. Everything is built with DOM APIs (never
   innerHTML), so catalogue data can never be interpreted as markup. */
(function () {
    'use strict';

    const SEED_TENANTS = [
        { id: '17000000-0000-4000-a000-000000000000', label: 'Afrindia Telecom (demo)' },
        { id: '27000000-0000-4000-a000-000000000000', label: 'Northwind Mobile (demo)' },
    ];

    const store = {
        get(key, fallback) {
            try {
                const v = localStorage.getItem(key);
                return v === null ? fallback : v;
            } catch {
                return fallback;
            }
        },
        set(key, value) {
            try {
                if (value === null || value === undefined || value === '') localStorage.removeItem(key);
                else localStorage.setItem(key, value);
            } catch {
                /* storage unavailable: settings last for this page only */
            }
        },
    };

    /** h('div.card', {onclick}, child, ...) */
    function h(tag, attrs, ...children) {
        const [name, ...classes] = tag.split('.');
        const el = document.createElement(name || 'div');
        if (classes.length) el.className = classes.join(' ');
        if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
            children.unshift(attrs);
            attrs = null;
        }
        for (const [k, v] of Object.entries(attrs || {})) {
            if (v === undefined || v === null || v === false) continue;
            if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
            else if (k === 'dataset') Object.assign(el.dataset, v);
            else if (k === 'value') el.value = v;
            else if (v === true) el.setAttribute(k, '');
            else el.setAttribute(k, String(v));
        }
        append(el, children);
        return el;
    }

    function append(el, children) {
        for (const c of children.flat(Infinity)) {
            if (c === null || c === undefined || c === false) continue;
            el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return el;
    }

    function clear(el) {
        while (el.firstChild) el.removeChild(el.firstChild);
        return el;
    }

    function toast(message, kind = 'success') {
        let host = document.getElementById('toasts');
        if (!host) {
            host = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' });
            document.body.appendChild(host);
        }
        const t = h(`div.toast.${kind}`, message);
        host.appendChild(t);
        setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
    }

    class ApiError extends Error {
        constructor(status, message, details) {
            super(message);
            this.status = status;
            this.details = details;
        }
    }

    /** Session: which tenant (dev mode) or API key the UI calls with. */
    const session = {
        tenantId: () => store.get('catalogue.tenantId', SEED_TENANTS[0].id),
        apiKey: () => store.get('catalogue.apiKey', ''),
        setTenantId: (v) => store.set('catalogue.tenantId', v),
        setApiKey: (v) => store.set('catalogue.apiKey', v),
    };

    async function request(method, url, body, extraHeaders) {
        const headers = { Accept: 'application/json', ...(extraHeaders || {}) };
        const key = session.apiKey();
        if (key) headers['x-api-key'] = key;
        else headers['x-tenant-id'] = session.tenantId();
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        } catch (err) {
            throw new ApiError(0, 'The API is not reachable. Is the server running?');
        }
        if (res.status === 204) return { data: null, headers: res.headers };
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = text;
        }
        if (!res.ok) {
            // internal API: {error:{message,details}}; TMF620: {reason,message}
            const message = (data && data.error && data.error.message) || (data && data.reason) || `HTTP ${res.status}`;
            const details = (data && data.error && data.error.details) || (data && data.message) || undefined;
            throw new ApiError(res.status, message, details);
        }
        return { data, headers: res.headers };
    }

    function errorText(err) {
        if (!(err instanceof ApiError)) return String(err && err.message ? err.message : err);
        let detail = '';
        if (Array.isArray(err.details)) {
            detail = err.details.map((d) => (typeof d === 'string' ? d : d.field ? `${d.field}: ${d.message}` : JSON.stringify(d))).join('; ');
        } else if (err.details && typeof err.details === 'object' && err.details.allowed) {
            detail = `allowed: ${err.details.allowed.join(', ') || 'none'}`;
        }
        return detail ? `${err.message} (${detail})` : err.message;
    }

    function money(value, currency) {
        if (value === null || value === undefined) return '—';
        const n = Number(value);
        const formatted = Number.isFinite(n)
            ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
            : String(value);
        return currency ? `${formatted} ${currency}` : formatted;
    }

    function date(value) {
        if (!value) return '—';
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    }

    function statusBadge(status) {
        const s = String(status || '').toLowerCase();
        const cls = { draft: 'draft', approved: 'approved', released: 'released', retired: 'retired', 'in design': 'draft', 'in test': 'approved', launched: 'released' }[s] || '';
        return h(`span.badge${cls ? '.' + cls : ''}`, status);
    }

    /** Reads a <form> into an object; empty strings become undefined; data-type="number|bool|json" coerces. */
    function formValues(form) {
        const out = {};
        for (const el of form.elements) {
            if (!el.name) continue;
            const type = el.dataset.type;
            if (el.type === 'checkbox') {
                out[el.name] = el.checked;
                continue;
            }
            const raw = el.value.trim();
            if (raw === '') continue;
            if (type === 'number') out[el.name] = Number(raw);
            else if (type === 'json') out[el.name] = JSON.parse(raw);
            else if (type === 'datetime') out[el.name] = new Date(raw).toISOString();
            else out[el.name] = raw;
        }
        return out;
    }

    function field(labelText, control, opts = {}) {
        return h(`div.field${opts.wide ? '.wide' : ''}`, h('label', labelText), control);
    }

    function select(name, options, opts = {}) {
        const el = h('select', { name, required: opts.required });
        if (opts.placeholder !== undefined) el.appendChild(h('option', { value: '' }, opts.placeholder));
        for (const o of options) {
            const opt = h('option', { value: o.value }, o.label);
            if (opts.value !== undefined && String(opts.value) === String(o.value)) opt.selected = true;
            el.appendChild(opt);
        }
        return el;
    }

    window.Catalogue = { SEED_TENANTS, store, h, append, clear, toast, request, ApiError, errorText, money, date, statusBadge, formValues, field, select, session };
})();
