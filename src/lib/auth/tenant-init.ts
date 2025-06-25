import { ObjectId } from "mongodb";
import { insertOne, findOne } from "../db";
import { Tenant, Role, Permission } from "../db/schemas";
import { DEFAULT_ROLES } from "./permissions";

export async function initializeTenant(
  name: string,
  slug: string,
  settings: Tenant["settings"]
): Promise<string> {
  // Create tenant
  const tenant: Omit<Tenant, "_id"> = {
    name,
    slug,
    settings,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const tenantId = await insertOne("tenants", tenant);

  // Create default roles
  for (const [roleName, roleData] of Object.entries(DEFAULT_ROLES)) {
    const role: Omit<Role, "_id"> = {
      tenantId: new ObjectId(tenantId),
      name: roleName,
      description: roleData.description,
      permissions: roleData.permissions,
      hierarchy: roleData.hierarchy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await insertOne("roles", role);
  }

  // Create default permissions
  const defaultPermissions = [
    {
      name: "tenant:manage",
      description: "Manage tenant settings",
      resource: "tenant",
      action: "manage",
    },
    {
      name: "user:manage",
      description: "Manage users",
      resource: "user",
      action: "manage",
    },
    {
      name: "role:manage",
      description: "Manage roles",
      resource: "role",
      action: "manage",
    },
    {
      name: "permission:manage",
      description: "Manage permissions",
      resource: "permission",
      action: "manage",
    },
    {
      name: "invite:manage",
      description: "Manage invites",
      resource: "invite",
      action: "manage",
    },
    {
      name: "skillAssessment:manage",
      description: "Manage skill assessments",
      resource: "skillAssessment",
      action: "manage",
    },
    {
      name: "user:read",
      description: "Read user information",
      resource: "user",
      action: "read",
    },
    {
      name: "user:update",
      description: "Update user information",
      resource: "user",
      action: "update",
    },
    {
      name: "skillAssessment:read",
      description: "Read skill assessments",
      resource: "skillAssessment",
      action: "read",
    },
    {
      name: "skillAssessment:create",
      description: "Create skill assessments",
      resource: "skillAssessment",
      action: "create",
    },
    {
      name: "skillAssessment:update",
      description: "Update skill assessments",
      resource: "skillAssessment",
      action: "update",
    },
  ];

  for (const permissionData of defaultPermissions) {
    const permission: Omit<Permission, "_id"> = {
      tenantId: new ObjectId(tenantId),
      name: permissionData.name,
      description: permissionData.description,
      resource: permissionData.resource,
      action: permissionData.action,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await insertOne("permissions", permission);
  }

  return tenantId;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  return findOne<Tenant>("tenants", { slug });
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  return findOne<Tenant>("tenants", { _id: new ObjectId(id) });
}

export async function validateTenantSlug(slug: string): Promise<boolean> {
  // Check if slug is valid
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return false;
  }

  // Check if slug is already taken
  const existingTenant = await getTenantBySlug(slug);
  return !existingTenant;
} 