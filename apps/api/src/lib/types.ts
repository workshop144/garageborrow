import type {
  AuditEntityType,
  AuditActionType,
  Garage,
  GarageMembership,
} from "@garageborrow/shared";

export interface AuthUser {
  phone: string;
  sub: string;
}

export interface AuditDetails {
  action_type: AuditActionType;
  entity_type: AuditEntityType;
  entity_id: string;
  before_snapshot: unknown | null;
  after_snapshot: unknown | null;
}

export interface AppVariables {
  user: AuthUser;
  garage: Garage;
  membership: GarageMembership;
  isOwner: boolean;
  idempotency_key: string;
  request_id: string;
  // Audit middleware reads these on response: handlers populate them via
  // setAuditDetails(c, ...) before returning.
  audit_details: AuditDetails;
}

export type AppEnv = { Variables: Partial<AppVariables> };
