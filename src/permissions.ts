import type {
  Permission,
  PermissionScope,
  RiskLevel,
  PermissionCheck,
  PermissionResult,
  AuditLogEntry,
  ConfirmationHandler,
} from './types/permissions';

/**
 * Permission policy configuration
 */
export interface PermissionPolicy {
  defaultAllow: boolean;
  rules: PermissionRule[];
}

/**
 * Permission rule definition
 */
export interface PermissionRule {
  permission: string;
  allow: boolean;
  conditions?: PermissionCondition[];
  reason?: string;
}

/**
 * Permission condition for rule matching
 */
export interface PermissionCondition {
  type: string;
  operator:
    | 'equals'
    | 'startsWith'
    | 'endsWith'
    | 'contains'
    | 'regex'
    | 'between';
  value: string | string[];
  contextKey?: string;
}

/**
 * Permission manager for controlling access to system resources and operations
 */
export class PermissionManager {
  private permissions = new Map<string, Permission>();
  private policy: PermissionPolicy = {
    defaultAllow: true,
    rules: [],
  };
  private grantedPermissions = new Set<string>();
  private temporaryPermissions = new Map<string, Date>();
  private limitedPermissions = new Map<string, number>();
  private auditLog: AuditLogEntry[] = [];
  private confirmationHandler?: ConfirmationHandler;

  constructor() {
    this.initializeDefaultPermissions();
  }

  private initializeDefaultPermissions(): void {
    // Initialize default permissions for common operations
    const defaultPermissions: Permission[] = [
      { name: 'file.read', scope: 'file', risk: 'low' },
      { name: 'file.write', scope: 'file', risk: 'medium' },
      { name: 'file.delete', scope: 'file', risk: 'high' },
      { name: 'bash.execute', scope: 'system', risk: 'high' },
      { name: 'network.request', scope: 'network', risk: 'medium' },
      { name: 'system.execute', scope: 'system', risk: 'high' },
    ];

    defaultPermissions.forEach(perm => this.register(perm));
  }

  /**
   * Register a new permission
   */
  register(permission: Permission): void {
    this.permissions.set(permission.name, permission);
  }

  /**
   * Get all registered permissions
   */
  getPermissions(): Permission[] {
    return Array.from(this.permissions.values());
  }

  /**
   * Get permissions by risk level
   */
  getPermissionsByRisk(risk: RiskLevel): Permission[] {
    return this.getPermissions().filter(p => p.risk === risk);
  }

  /**
   * Get permissions by scope
   */
  getPermissionsByScope(scope: PermissionScope): Permission[] {
    return this.getPermissions().filter(p => p.scope === scope);
  }

  /**
   * Set permission policy
   */
  setPolicy(policy: PermissionPolicy): void {
    this.policy = policy;
  }

  /**
   * Get current permission policy
   */
  getPolicy(): PermissionPolicy {
    return { ...this.policy };
  }

  /**
   * Check if a permission is granted
   */
  async check(check: PermissionCheck): Promise<PermissionResult> {
    const permission = this.permissions.get(check.permission);

    if (!permission) {
      const result: PermissionResult = {
        granted: false,
        reason: `Unknown permission: ${check.permission}`,
        permission: check.permission,
        context: check.context,
        timestamp: new Date(),
      };
      this.auditLog.push({
        timestamp: new Date(),
        permission: check.permission,
        context: check.context,
        result,
      });
      return result;
    }

    // Check temporary permissions first (and clean up expired ones)
    this.cleanupExpiredPermissions();
    const tempExpiry = this.temporaryPermissions.get(check.permission);
    if (tempExpiry && tempExpiry > new Date()) {
      const result: PermissionResult = {
        granted: true,
        reason: undefined,
        permission: check.permission,
        context: check.context,
        timestamp: new Date(),
        expiresAt: tempExpiry,
      };
      this.auditLog.push({
        timestamp: new Date(),
        permission: check.permission,
        context: check.context,
        result,
      });
      return result;
    }

    // Check limited permissions
    const remainingUses = this.limitedPermissions.get(check.permission);
    if (remainingUses !== undefined) {
      if (remainingUses > 0) {
        this.limitedPermissions.set(check.permission, remainingUses - 1);
        const result: PermissionResult = {
          granted: true,
          reason: undefined,
          permission: check.permission,
          context: check.context,
          timestamp: new Date(),
          remainingUses: remainingUses - 1,
        };
        this.auditLog.push({
          timestamp: new Date(),
          permission: check.permission,
          context: check.context,
          result,
        });
        return result;
      } else {
        // Remove exhausted permission
        this.limitedPermissions.delete(check.permission);
      }
    }

    // Check explicitly granted permissions
    if (
      this.grantedPermissions.has(check.permission) ||
      this.hasWildcardMatch(check.permission) ||
      this.hasHierarchicalMatch(check.permission)
    ) {
      // Check if confirmation is required
      if (permission.requiresConfirmation && this.confirmationHandler) {
        const confirmed = await this.confirmationHandler({
          permission: check.permission,
          risk: permission.risk,
          context: check.context,
        });

        if (!confirmed) {
          const result: PermissionResult = {
            granted: false,
            reason: 'User confirmation denied',
            permission: check.permission,
            context: check.context,
            timestamp: new Date(),
          };
          this.auditLog.push({
            timestamp: new Date(),
            permission: check.permission,
            context: check.context,
            result,
          });
          return result;
        }
      }

      const result: PermissionResult = {
        granted: true,
        reason: undefined,
        permission: check.permission,
        context: check.context,
        timestamp: new Date(),
      };
      this.auditLog.push({
        timestamp: new Date(),
        permission: check.permission,
        context: check.context,
        result,
      });
      return result;
    }

    // Check policy rules
    for (const rule of this.policy.rules) {
      if (this.matchesPermission(rule.permission, check.permission)) {
        if (this.evaluateConditions(rule.conditions ?? [], check.context)) {
          let reason = rule.reason ?? 'Denied by policy rule';

          // Provide specific reasons for certain condition types
          if (!rule.allow && rule.conditions) {
            const timeCondition = rule.conditions.find(c => c.type === 'time');
            if (timeCondition) {
              reason = 'Access denied due to time restriction';
            }
          }

          const result: PermissionResult = {
            granted: rule.allow,
            reason: rule.allow ? undefined : reason,
            permission: check.permission,
            context: check.context,
            timestamp: new Date(),
            rule: rule,
          };
          this.auditLog.push({
            timestamp: new Date(),
            permission: check.permission,
            context: check.context,
            result,
          });
          return result;
        }
      }
    }

    // Apply default policy
    const result: PermissionResult = {
      granted: this.policy.defaultAllow,
      reason: this.policy.defaultAllow ? undefined : 'denied by default policy',
      permission: check.permission,
      context: check.context,
      timestamp: new Date(),
    };
    this.auditLog.push({
      timestamp: new Date(),
      permission: check.permission,
      context: check.context,
      result,
    });
    return result;
  }

  /**
   * Check if a rule permission pattern matches the requested permission
   */
  private matchesPermission(
    rulePermission: string,
    requestedPermission: string
  ): boolean {
    // Exact match
    if (rulePermission === requestedPermission) {
      return true;
    }

    // Wildcard matching (e.g., "file.*" matches "file.read")
    if (rulePermission.endsWith('*')) {
      const prefix = rulePermission.slice(0, -1);
      return requestedPermission.startsWith(prefix);
    }

    // Hierarchical matching (e.g., "file" matches "file.read")
    return requestedPermission.startsWith(rulePermission + '.');
  }

  /**
   * Evaluate permission conditions against context
   */
  private evaluateConditions(
    conditions: PermissionCondition[],
    context: Record<string, unknown>
  ): boolean {
    if (conditions.length === 0) {
      return true;
    }

    return conditions.every(condition =>
      this.evaluateCondition(condition, context)
    );
  }

  /**
   * Evaluate a single permission condition
   */
  private evaluateCondition(
    condition: PermissionCondition,
    context: Record<string, unknown>
  ): boolean {
    // Get the context value based on condition type
    let contextValue: string;
    if (condition.contextKey) {
      contextValue = String(context[condition.contextKey] ?? '');
    } else {
      // Map condition types to common context keys
      switch (condition.type) {
        case 'path':
        case 'resource':
          contextValue = String(context.resource ?? context.path ?? '');
          break;
        case 'time':
          contextValue = new Date().toTimeString();
          break;
        default:
          contextValue = String(context[condition.type] ?? '');
      }
    }

    switch (condition.operator) {
      case 'equals':
        return contextValue === condition.value;
      case 'startsWith':
        return typeof condition.value === 'string'
          ? contextValue.startsWith(condition.value)
          : condition.value.some(v => contextValue.startsWith(v));
      case 'endsWith':
        return typeof condition.value === 'string'
          ? contextValue.endsWith(condition.value)
          : condition.value.some(v => contextValue.endsWith(v));
      case 'contains':
        return typeof condition.value === 'string'
          ? contextValue.includes(condition.value)
          : condition.value.some(v => contextValue.includes(v));
      case 'regex':
        try {
          const pattern =
            typeof condition.value === 'string'
              ? condition.value
              : condition.value.join('|');
          return new RegExp(pattern).test(contextValue);
        } catch {
          return false;
        }
      case 'between':
        // Handle time-based between conditions
        if (condition.type === 'time' && Array.isArray(condition.value)) {
          const currentTime = new Date().toTimeString().substring(0, 5); // HH:MM format
          const [start, end] = condition.value as [string, string];

          // Handle overnight ranges (e.g., 22:00 to 06:00)
          if (start > end) {
            return currentTime >= start || currentTime <= end;
          } else {
            return currentTime >= start && currentTime <= end;
          }
        }
        return false;
      default:
        return false;
    }
  }

  /**
   * Clean up expired temporary permissions
   */
  private cleanupExpiredPermissions(): void {
    const now = new Date();
    for (const [permission, expiry] of this.temporaryPermissions) {
      if (expiry <= now) {
        this.temporaryPermissions.delete(permission);
      }
    }
  }

  /**
   * Check if permission matches any wildcard grants
   */
  private hasWildcardMatch(permission: string): boolean {
    for (const granted of this.grantedPermissions) {
      if (granted.endsWith('*')) {
        const prefix = granted.slice(0, -1);
        if (permission.startsWith(prefix)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Check if permission matches any hierarchical grants
   */
  private hasHierarchicalMatch(permission: string): boolean {
    for (const granted of this.grantedPermissions) {
      if (!granted.includes('.') && permission.startsWith(granted + '.')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if user confirmation is required for a permission
   */
  requiresConfirmation(permissionName: string): boolean {
    const permission = this.permissions.get(permissionName);
    return permission?.requiresConfirmation ?? false;
  }

  /**
   * Get permission by name
   */
  getPermission(name: string): Permission | undefined {
    return this.permissions.get(name);
  }

  /**
   * Remove a registered permission
   */
  unregister(name: string): boolean {
    return this.permissions.delete(name);
  }

  /**
   * Clear all registered permissions
   */
  clear(): void {
    this.permissions.clear();
  }

  /**
   * Export current configuration
   */
  exportConfig(): { permissions: Permission[]; policy: PermissionPolicy } {
    return {
      permissions: this.getPermissions(),
      policy: this.getPolicy(),
    };
  }

  /**
   * Import configuration
   */
  importConfig(config: {
    permissions?: Permission[];
    policy?: PermissionPolicy;
  }): void {
    if (config.permissions) {
      this.permissions.clear();
      config.permissions.forEach(perm => this.register(perm));
    }

    if (config.policy) {
      this.setPolicy(config.policy);
    }
  }

  /**
   * Grant a specific permission
   */
  grant(permission: string): void {
    this.grantedPermissions.add(permission);
  }

  /**
   * Revoke a specific permission
   */
  revoke(permission: string): void {
    this.grantedPermissions.delete(permission);
    this.temporaryPermissions.delete(permission);
    this.limitedPermissions.delete(permission);
  }

  /**
   * Grant a permission with expiration time
   */
  grantTemporary(permission: string, expiresAt: Date): void {
    this.temporaryPermissions.set(permission, expiresAt);
  }

  /**
   * Grant a permission with usage limit
   */
  grantWithLimit(permission: string, maxUses: number): void {
    this.limitedPermissions.set(permission, maxUses);
  }

  /**
   * Grant all permissions in a scope
   */
  grantScope(scope: PermissionScope): void {
    this.getPermissionsByScope(scope).forEach(perm => {
      this.grant(perm.name);
    });
  }

  /**
   * Get list of granted permissions
   */
  getGranted(): string[] {
    return Array.from(this.grantedPermissions);
  }

  /**
   * Set confirmation handler
   */
  setConfirmationHandler(handler: ConfirmationHandler): void {
    this.confirmationHandler = handler;
  }

  /**
   * Get audit log
   */
  getAuditLog(options?: { filter?: 'granted' | 'denied' }): AuditLogEntry[] {
    if (!options?.filter) {
      return [...this.auditLog];
    }

    return this.auditLog.filter(entry => {
      if (options.filter === 'granted') {
        return entry.result.granted;
      } else if (options.filter === 'denied') {
        return !entry.result.granted;
      }
      return true;
    });
  }
}

// Export types for convenience
export type {
  Permission,
  PermissionScope,
  RiskLevel,
  PermissionCheck,
  PermissionResult,
} from './types/permissions';

// PermissionPolicy, PermissionRule, and PermissionCondition are already exported above as interfaces
