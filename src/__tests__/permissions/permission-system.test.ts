import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  Permission,
  PermissionScope,
  PermissionCheck,
  PermissionPolicy,
} from '../../permissions';
import { PermissionManager } from '../../permissions';

describe('Permission System', () => {
  let permissionManager: PermissionManager;

  beforeEach(() => {
    permissionManager = new PermissionManager();
  });

  describe('Permission Definitions', () => {
    it('should define basic permissions', () => {
      const permission: Permission = {
        name: 'file.write',
        scope: 'tool',
        description: 'Permission to write files',
        risk: 'medium',
      };

      expect(permission.name).toBe('file.write');
      expect(permission.scope).toBe('tool');
      expect(permission.risk).toBe('medium');
    });

    it('should support hierarchical permissions', () => {
      // Clear default permissions first
      permissionManager.clear();

      const permissions: Permission[] = [
        { name: 'file', scope: 'tool', risk: 'low' },
        { name: 'file.read', scope: 'tool', risk: 'low' },
        { name: 'file.write', scope: 'tool', risk: 'medium' },
        { name: 'file.delete', scope: 'tool', risk: 'high' },
      ];

      permissions.forEach(perm => {
        permissionManager.register(perm);
      });

      expect(permissionManager.getPermissions()).toHaveLength(4);
    });

    it('should categorize permissions by risk level', () => {
      const highRisk: Permission = {
        name: 'system.execute',
        scope: 'system',
        risk: 'critical',
        requiresConfirmation: true,
      };

      permissionManager.register(highRisk);

      const critical = permissionManager.getPermissionsByRisk('critical');
      expect(critical).toHaveLength(1);
      expect(critical[0].requiresConfirmation).toBe(true);
    });
  });

  describe('Permission Checking', () => {
    beforeEach(() => {
      // Register some test permissions
      permissionManager.register({
        name: 'bash.execute',
        scope: 'tool',
        risk: 'high',
      });

      permissionManager.register({
        name: 'file.read',
        scope: 'tool',
        risk: 'low',
      });
    });

    it('should check if permission is granted', async () => {
      const check: PermissionCheck = {
        permission: 'file.read',
        context: {
          user: 'test-user',
          tool: 'FileTool',
          action: 'read',
          resource: '/home/user/file.txt',
        },
      };

      const result = await permissionManager.check(check);

      expect(result.granted).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should deny permission when not granted', async () => {
      permissionManager.setPolicy({
        defaultAllow: false,
        rules: [],
      });

      const check: PermissionCheck = {
        permission: 'bash.execute',
        context: {
          user: 'test-user',
          tool: 'BashTool',
          action: 'execute',
          command: 'rm -rf /',
        },
      };

      const result = await permissionManager.check(check);

      expect(result.granted).toBe(false);
      expect(result.reason).toContain('denied');
    });

    it('should respect wildcard permissions', async () => {
      permissionManager.grant('file.*');

      const checks = [
        { permission: 'file.read' },
        { permission: 'file.write' },
        { permission: 'file.delete' },
      ];

      for (const check of checks) {
        const result = await permissionManager.check({
          ...check,
          context: { user: 'test' },
        });
        expect(result.granted).toBe(true);
      }
    });

    it('should handle permission inheritance', async () => {
      permissionManager.grant('file');

      const result = await permissionManager.check({
        permission: 'file.read',
        context: { user: 'test' },
      });

      expect(result.granted).toBe(true); // Child permission inherited
    });
  });

  describe('Permission Policies', () => {
    it('should apply default allow policy', () => {
      const policy: PermissionPolicy = {
        defaultAllow: true,
        rules: [],
      };

      permissionManager.setPolicy(policy);

      const currentPolicy = permissionManager.getPolicy();
      expect(currentPolicy.defaultAllow).toBe(true);
    });

    it('should apply default deny policy', () => {
      const policy: PermissionPolicy = {
        defaultAllow: false,
        rules: [
          {
            permission: 'file.read',
            allow: true,
            conditions: [],
          },
        ],
      };

      permissionManager.setPolicy(policy);

      const currentPolicy = permissionManager.getPolicy();
      expect(currentPolicy.defaultAllow).toBe(false);
      expect(currentPolicy.rules).toHaveLength(1);
    });

    it('should evaluate conditions in rules', async () => {
      const policy: PermissionPolicy = {
        defaultAllow: false,
        rules: [
          {
            permission: 'file.write',
            allow: true,
            conditions: [
              {
                type: 'path',
                operator: 'startsWith',
                value: '/home/user/safe/',
              },
            ],
          },
        ],
      };

      permissionManager.setPolicy(policy);

      const safeWrite = await permissionManager.check({
        permission: 'file.write',
        context: {
          resource: '/home/user/safe/file.txt',
        },
      });

      const unsafeWrite = await permissionManager.check({
        permission: 'file.write',
        context: {
          resource: '/etc/passwd',
        },
      });

      expect(safeWrite.granted).toBe(true);
      expect(unsafeWrite.granted).toBe(false);
    });

    it('should support time-based conditions', async () => {
      const policy: PermissionPolicy = {
        defaultAllow: true,
        rules: [
          {
            permission: 'system.execute',
            allow: false,
            conditions: [
              {
                type: 'time',
                operator: 'between',
                value: ['22:00', '06:00'], // Block at night
              },
            ],
          },
        ],
      };

      permissionManager.setPolicy(policy);

      // Mock time
      const mockDate = new Date('2024-01-01T23:00:00');
      vi.setSystemTime(mockDate);

      const result = await permissionManager.check({
        permission: 'system.execute',
        context: {},
      });

      expect(result.granted).toBe(false);
      expect(result.reason).toContain('time restriction');

      vi.useRealTimers();
    });
  });

  describe('Permission Granting and Revoking', () => {
    it('should grant specific permissions', () => {
      permissionManager.grant('file.write');

      const granted = permissionManager.getGranted();
      expect(granted).toContain('file.write');
    });

    it('should revoke specific permissions', () => {
      permissionManager.grant('file.write');
      permissionManager.revoke('file.write');

      const granted = permissionManager.getGranted();
      expect(granted).not.toContain('file.write');
    });

    it('should grant permissions with expiration', async () => {
      // Set default deny so permission is only granted via temporary grant
      permissionManager.setPolicy({ defaultAllow: false, rules: [] });

      const expiration = new Date(Date.now() + 1000); // 1 second

      permissionManager.grantTemporary('file.delete', expiration);

      let result = await permissionManager.check({
        permission: 'file.delete',
        context: {},
      });
      expect(result.granted).toBe(true);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));

      result = await permissionManager.check({
        permission: 'file.delete',
        context: {},
      });
      expect(result.granted).toBe(false);
    });

    it('should grant permissions with usage limit', async () => {
      // Set default deny so permission is only granted via usage limit
      permissionManager.setPolicy({ defaultAllow: false, rules: [] });

      // Register the permission first
      permissionManager.register({
        name: 'api.call',
        scope: 'network',
        risk: 'medium',
      });

      permissionManager.grantWithLimit('api.call', 3);

      // Use up the limit
      for (let i = 0; i < 3; i++) {
        const result = await permissionManager.check({
          permission: 'api.call',
          context: {},
        });
        expect(result.granted).toBe(true);
      }

      // Should be denied after limit
      const result = await permissionManager.check({
        permission: 'api.call',
        context: {},
      });
      expect(result.granted).toBe(false);
      // The reason will be the default policy message since the limit is exhausted
      expect(result.reason).toBeDefined();
    });
  });

  describe('Permission Confirmation', () => {
    it('should require confirmation for high-risk permissions', async () => {
      const confirmMock = vi.fn().mockResolvedValue(true);

      permissionManager.setConfirmationHandler(confirmMock);
      permissionManager.register({
        name: 'system.delete',
        scope: 'system',
        risk: 'critical',
        requiresConfirmation: true,
      });

      // Grant the permission so confirmation logic is triggered
      permissionManager.grant('system.delete');

      const result = await permissionManager.check({
        permission: 'system.delete',
        context: {
          resource: '/important/file',
        },
      });

      expect(confirmMock).toHaveBeenCalledWith({
        permission: 'system.delete',
        risk: 'critical',
        context: expect.objectContaining({
          resource: '/important/file',
        }),
      });
      expect(result.granted).toBe(true);
    });

    it('should deny when confirmation is rejected', async () => {
      const confirmMock = vi.fn().mockResolvedValue(false);

      permissionManager.setConfirmationHandler(confirmMock);
      permissionManager.register({
        name: 'system.delete',
        scope: 'system',
        risk: 'critical',
        requiresConfirmation: true,
      });

      // Grant the permission so confirmation logic is triggered
      permissionManager.grant('system.delete');

      const result = await permissionManager.check({
        permission: 'system.delete',
        context: {},
      });

      expect(result.granted).toBe(false);
      expect(result.reason).toContain('confirmation denied');
    });
  });

  describe('Permission Auditing', () => {
    it('should log permission checks', async () => {
      await permissionManager.check({
        permission: 'file.read',
        context: { user: 'alice' },
      });

      await permissionManager.check({
        permission: 'bash.execute',
        context: { user: 'bob', command: 'ls' },
      });

      const auditLog = permissionManager.getAuditLog();
      expect(auditLog).toHaveLength(2);
      expect(auditLog[0].permission).toBe('file.read');
      expect(auditLog[1].permission).toBe('bash.execute');
    });

    it('should include timestamps in audit log', async () => {
      await permissionManager.check({
        permission: 'file.write',
        context: {},
      });

      const auditLog = permissionManager.getAuditLog();
      expect(auditLog[0].timestamp).toBeInstanceOf(Date);
    });

    it('should track denied permissions', async () => {
      permissionManager.setPolicy({
        defaultAllow: false,
        rules: [],
      });

      await permissionManager.check({
        permission: 'dangerous.operation',
        context: {},
      });

      const deniedLog = permissionManager.getAuditLog({
        filter: 'denied',
      });

      expect(deniedLog).toHaveLength(1);
      expect(deniedLog[0].result.granted).toBe(false);
    });
  });

  describe('Permission Scopes', () => {
    it('should support different permission scopes', () => {
      // Clear default permissions first
      permissionManager.clear();

      const scopes: PermissionScope[] = ['tool', 'system', 'network', 'file'];

      scopes.forEach(scope => {
        permissionManager.register({
          name: `${scope}.test`,
          scope,
          risk: 'low',
        });
      });

      const toolPerms = permissionManager.getPermissionsByScope('tool');
      const systemPerms = permissionManager.getPermissionsByScope('system');

      expect(toolPerms).toHaveLength(1);
      expect(systemPerms).toHaveLength(1);
    });

    it('should isolate permissions by scope', async () => {
      // Set default deny to properly test scope isolation
      permissionManager.setPolicy({ defaultAllow: false, rules: [] });

      // Register permissions first
      permissionManager.register({
        name: 'tool.execute',
        scope: 'tool',
        risk: 'low',
      });

      permissionManager.register({
        name: 'system.execute',
        scope: 'system',
        risk: 'high',
      });

      permissionManager.grantScope('tool');

      const toolResult = await permissionManager.check({
        permission: 'tool.execute',
        context: {},
      });

      const systemResult = await permissionManager.check({
        permission: 'system.execute',
        context: {},
      });

      expect(toolResult.granted).toBe(true);
      expect(systemResult.granted).toBe(false);
    });
  });
});
