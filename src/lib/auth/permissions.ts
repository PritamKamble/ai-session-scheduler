import { User, Role, Permission } from "../db/schemas";

export type Resource = 
  | "tenant"
  | "user"
  | "role"
  | "permission"
  | "invite"
  | "skillAssessment";

export type Action = 
  | "create"
  | "read"
  | "update"
  | "delete"
  | "manage";

export interface PermissionCheck {
  resource: Resource;
  action: Action;
}

// Default roles and their permissions
export const DEFAULT_ROLES = {
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Full access to all features and settings",
    hierarchy: 100,
    permissions: ["*:*"],
  },
  TENANT_ADMIN: {
    name: "Tenant Admin",
    description: "Full access to tenant features and settings",
    hierarchy: 90,
    permissions: [
      "tenant:manage",
      "user:manage",
      "role:manage",
      "permission:manage",
      "invite:manage",
      "skillAssessment:manage",
    ],
  },
  MANAGER: {
    name: "Manager",
    description: "Can manage team members and view reports",
    hierarchy: 80,
    permissions: [
      "user:read",
      "user:update",
      "skillAssessment:read",
      "skillAssessment:create",
      "skillAssessment:update",
    ],
  },
  MEMBER: {
    name: "Member",
    description: "Basic access to team features",
    hierarchy: 50,
    permissions: [
      "skillAssessment:read",
      "skillAssessment:create",
      "skillAssessment:update",
    ],
  },
};

// Helper function to check if a user has a specific permission
export function hasPermission(
  user: User,
  roles: Role[],
  permissions: Permission[],
  check: PermissionCheck
): boolean {
  // Super admin has all permissions
  if (user.roles.includes("SUPER_ADMIN")) {
    return true;
  }

  // Check direct permissions
  const directPermission = user.permissions.find(
    (p) => p === `${check.resource}:${check.action}` || p === "*:*"
  );
  if (directPermission) {
    return true;
  }

  // Check role-based permissions
  const userRoles = roles.filter((role) => user.roles.includes(role.name));
  for (const role of userRoles) {
    const rolePermissions = permissions.filter((p) =>
      role.permissions.includes(p.name)
    );

    for (const permission of rolePermissions) {
      if (
        (permission.resource === check.resource &&
          permission.action === check.action) ||
        permission.resource === "*" ||
        permission.action === "*"
      ) {
        return true;
      }
    }
  }

  return false;
}

// Helper function to get all permissions for a user
export function getUserPermissions(
  user: User,
  roles: Role[],
  permissions: Permission[]
): string[] {
  const userPermissions = new Set<string>();

  // Add direct permissions
  user.permissions.forEach((p) => userPermissions.add(p));

  // Add role-based permissions
  const userRoles = roles.filter((role) => user.roles.includes(role.name));
  for (const role of userRoles) {
    const rolePermissions = permissions.filter((p) =>
      role.permissions.includes(p.name)
    );
    rolePermissions.forEach((p) =>
      userPermissions.add(`${p.resource}:${p.action}`)
    );
  }

  return Array.from(userPermissions);
}

// Helper function to check if a user can manage another user
export function canManageUser(
  manager: User,
  target: User,
  roles: Role[],
  permissions: Permission[]
): boolean {
  // Super admin can manage anyone
  if (manager.roles.includes("SUPER_ADMIN")) {
    return true;
  }

  // Users can't manage themselves
  if (manager._id.toString() === target._id.toString()) {
    return false;
  }

  // Get manager's highest role hierarchy
  const managerRoles = roles.filter((role) => manager.roles.includes(role.name));
  const managerHighestHierarchy = Math.max(
    ...managerRoles.map((role) => role.hierarchy)
  );

  // Get target's highest role hierarchy
  const targetRoles = roles.filter((role) => target.roles.includes(role.name));
  const targetHighestHierarchy = Math.max(
    ...targetRoles.map((role) => role.hierarchy)
  );

  // Manager can only manage users with lower hierarchy
  return managerHighestHierarchy > targetHighestHierarchy;
}

// Helper function to validate role hierarchy
export function validateRoleHierarchy(
  newRole: Role,
  existingRoles: Role[]
): boolean {
  // Check if role name is unique
  if (existingRoles.some((role) => role.name === newRole.name)) {
    return false;
  }

  // Check if hierarchy is valid
  const minHierarchy = Math.min(...existingRoles.map((role) => role.hierarchy));
  const maxHierarchy = Math.max(...existingRoles.map((role) => role.hierarchy));

  return newRole.hierarchy >= minHierarchy && newRole.hierarchy <= maxHierarchy;
} 