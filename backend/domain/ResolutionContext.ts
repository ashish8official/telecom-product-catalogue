export interface ResolutionContext {
    tenant_id: string;
    offering_id: string;
    market_id?: string;
    subscriber_id?: string;
    account_id?: string;
    effective_at: Date;
    context_json?: Record<string, any>;
}
