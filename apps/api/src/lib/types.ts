import type { Garage, GarageMembership } from "@garageborrow/shared";

export interface AuthUser {
  phone: string;
  sub: string;
}

export interface AppVariables {
  user: AuthUser;
  garage: Garage;
  membership: GarageMembership;
  isOwner: boolean;
  idempotency_key: string;
  request_id: string;
}

export type AppEnv = { Variables: Partial<AppVariables> };
