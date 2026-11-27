import { pool, withTransaction } from '../db/pool';
import { badRequest, conflict, notFound, unprocessable } from '../http/errors';
import { CatalogueStatus, catalogueRepository, VersionSummary } from '../repositories/catalogueRepository';

/**
 * Catalogue version lifecycle: DRAFT → APPROVED → RELEASED → RETIRED (and DRAFT/APPROVED → RETIRED
 * to abandon). The status trigger from migration 001 enforces the allowed transitions; this service
 * adds readiness checks and turns failures into clear API errors.
 */
const TRANSITIONS: Record<CatalogueStatus, CatalogueStatus[]> = {
    DRAFT: ['APPROVED', 'RETIRED'],
    APPROVED: ['RELEASED', 'RETIRED'],
    RELEASED: ['RETIRED'],
    RETIRED: [],
};

export const catalogueService = {
    listCatalogues: (tenantId: string) => catalogueRepository.listCatalogues(pool, tenantId),

    async getCatalogue(tenantId: string, id: string) {
        const catalogue = await catalogueRepository.getCatalogue(pool, tenantId, id);
        if (!catalogue) throw notFound('Catalogue', id);
        return { ...catalogue, versions: await catalogueRepository.listVersions(pool, tenantId, id) };
    },

    createCatalogue: (tenantId: string, input: { name: string; description?: string | null }) =>
        catalogueRepository.createCatalogue(pool, tenantId, input),

    async updateCatalogue(tenantId: string, id: string, input: { name?: string; description?: string | null }) {
        const updated = await catalogueRepository.updateCatalogue(pool, tenantId, id, input);
        if (!updated) throw notFound('Catalogue', id);
        return updated;
    },

    listVersions: (tenantId: string, catalogueId?: string) => catalogueRepository.listVersions(pool, tenantId, catalogueId),

    async getVersion(tenantId: string, id: string): Promise<VersionSummary> {
        const version = await catalogueRepository.getVersion(pool, tenantId, id);
        if (!version) throw notFound('Catalogue version', id);
        return version;
    },

    /** Creates a new DRAFT version, optionally as a deep copy of an existing version of the same catalogue. */
    async createVersion(
        tenantId: string,
        input: { catalogue_id: string; version: string; valid_from?: Date | null; valid_to?: Date | null; clone_from_version_id?: string }
    ) {
        return withTransaction(async (tx) => {
            const catalogue = await catalogueRepository.getCatalogue(tx, tenantId, input.catalogue_id);
            if (!catalogue) throw notFound('Catalogue', input.catalogue_id);
            if (input.clone_from_version_id) {
                const source = await catalogueRepository.getVersion(tx, tenantId, input.clone_from_version_id);
                if (!source) throw notFound('Catalogue version', input.clone_from_version_id);
                if (source.catalogue_id !== input.catalogue_id) {
                    throw badRequest('A version can only be cloned from another version of the same catalogue');
                }
            }
            const created = await catalogueRepository.createVersion(tx, tenantId, input);
            const copied = input.clone_from_version_id
                ? await catalogueRepository.cloneVersionContent(tx, tenantId, input.clone_from_version_id, created.id)
                : 0;
            return { ...created, cloned_offering_count: copied };
        });
    },

    async updateVersion(tenantId: string, id: string, input: { version?: string; valid_from?: Date | null; valid_to?: Date | null }) {
        const current = await this.getVersion(tenantId, id);
        if (current.status !== 'DRAFT') {
            throw conflict(`Catalogue version ${current.version} is ${current.status}; only DRAFT versions can be edited`);
        }
        return catalogueRepository.updateVersion(pool, tenantId, id, input);
    },

    async transition(tenantId: string, id: string, target: CatalogueStatus) {
        return withTransaction(async (tx) => {
            const current = await catalogueRepository.getVersion(tx, tenantId, id, { forUpdate: true });
            if (!current) throw notFound('Catalogue version', id);
            if (current.status === target) return current;
            if (!TRANSITIONS[current.status].includes(target)) {
                throw conflict(`A ${current.status} catalogue version cannot move to ${target}`, {
                    allowed: TRANSITIONS[current.status],
                });
            }
            if (target === 'APPROVED' || target === 'RELEASED') {
                const problems = await catalogueRepository.readinessProblems(tx, tenantId, id);
                if (problems.length) throw unprocessable(`Catalogue version ${current.version} is not ready to be ${target.toLowerCase()}`, problems);
            }
            if (target === 'RELEASED' && current.valid_to && current.valid_to <= new Date()) {
                throw unprocessable('valid_to is in the past; this version would never be in force');
            }
            await catalogueRepository.setStatus(tx, tenantId, id, target, target === 'RELEASED' ? new Date() : undefined);
            return (await catalogueRepository.getVersion(tx, tenantId, id))!;
        });
    },

    async deleteVersion(tenantId: string, id: string) {
        const current = await this.getVersion(tenantId, id);
        if (current.status === 'RELEASED' || current.status === 'RETIRED') {
            throw conflict(`A ${current.status} catalogue version is part of the commercial record and cannot be deleted`);
        }
        if (current.status === 'APPROVED') {
            throw conflict('An APPROVED catalogue version cannot be deleted; retire it instead');
        }
        await catalogueRepository.deleteVersion(pool, tenantId, id);
    },

    /** Throws 409 unless the version exists and is DRAFT. */
    async assertDraft(tenantId: string, versionId: string, db = pool): Promise<VersionSummary> {
        const version = await catalogueRepository.getVersion(db, tenantId, versionId);
        if (!version) throw notFound('Catalogue version', versionId);
        if (version.status !== 'DRAFT') {
            throw conflict(`Catalogue version ${version.version} is ${version.status}; only DRAFT versions can be edited. Create a new version instead.`);
        }
        return version;
    },
};
