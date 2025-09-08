/**
 * Permission scopes
 */
export type PermissionScope = 'tool' | 'system' | 'network' | 'file' | 'custom';

/**
 * Risk levels for permissions
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Permission definition
 */
export interface Permission {
  name: string;
  scope: PermissionScope;
  description?: string;
  risk: RiskLevel;
  requiresConfirmation?: boolean;
  parent?: string;
}

/**
 * Permission check request
 */
export interface PermissionCheck {
  permission: string;
  context: Record<string, unknown>;
}

/**
 * Permission check result
 */
export interface PermissionResult {
  granted: boolean;
  reason?: string;
  permission: string;
  context: Record<string, unknown>;
  timestamp: Date;
  rule?: unknown;
  expiresAt?: Date;
  remainingUses?: number;
}

/**
 * Condition operators
 */
export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'contains'
  | 'matches'
  | 'between'
  | 'lessThan'
  | 'greaterThan';

/**
 * Permission rule condition
 */
export interface PermissionCondition {
  type: string;
  operator: ConditionOperator;
  value: unknown;
}

/**
 * Permission rule
 */
export interface PermissionRule {
  permission: string;
  allow: boolean;
  conditions: PermissionCondition[];
}

/**
 * Permission policy
 */
export interface PermissionPolicy {
  defaultAllow: boolean;
  rules: PermissionRule[];
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  timestamp: Date;
  permission: string;
  context: Record<string, unknown>;
  result: PermissionResult;
}

/**
 * Confirmation handler
 */
export type ConfirmationHandler = (details: {
  permission: string;
  risk: RiskLevel;
  context: Record<string, unknown>;
}) => Promise<boolean>;

/**
 * Temporary permission
 */
export interface TemporaryPermission {
  permission: string;
  expiresAt: Date;
}

/**
 * Limited permission
 */
export interface LimitedPermission {
  permission: string;
  remainingUses: number;
}
