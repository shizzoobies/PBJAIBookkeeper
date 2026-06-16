// Shared domain types used by both the Worker and (later) the dashboard.
// Intentionally minimal for the foundation; expanded in Phase 1.

export type RealmStatus = 'active' | 'reauth_needed' | 'disconnected';

export type ReviewStatus = 'pending' | 'approved' | 'adjusted';

export interface ConnectedCompany {
  realmId: string;
  companyName: string | null;
  status: RealmStatus;
}
