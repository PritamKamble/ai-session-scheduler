import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { insertOne, findOne, find, updateOne, deleteOne } from "@/lib/db";
import { createProtectedApiHandler } from "@/lib/auth/api-protection";
import { Role, Permission } from "@/lib/db/schemas";
import { validateRoleHierarchy } from "@/lib/auth/permissions";

async function handler(req: NextRequest) {
  const { method } = req;

  switch (method) {
    case "POST":
      return handleCreate(req);
    case "GET":
      return handleGet(req);
    case "PUT":
      return handleUpdate(req);
    case "DELETE":
      return handleDelete(req);
    default:
      return NextResponse.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
  }
}

async function handleCreate(req: NextRequest) {
  try {
    const tenantId = req.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID is required" },
        { status: 400 }
      );
    }

    const data = await req.json();
    const { name, description, permissions, hierarchy } = data;

    // Validate required fields
    if (!name || !description || !permissions || !hierarchy) {
      return NextResponse.json(
        { error: "Name, description, permissions, and hierarchy are required" },
        { status: 400 }
      );
    }

    // Validate permissions
    const validPermissions = await find<Permission>("permissions", {
      tenantId: new ObjectId(tenantId),
      name: { $in: permissions },
    });

    if (validPermissions.length !== permissions.length) {
      return NextResponse.json(
        { error: "Invalid permissions" },
        { status: 400 }
      );
    }

    // Get existing roles
    const existingRoles = await find<Role>("roles", {
      tenantId: new ObjectId(tenantId),
    });

    // Create new role
    const newRole: Omit<Role, "_id"> = {
      tenantId: new ObjectId(tenantId),
      name,
      description,
      permissions,
      hierarchy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Validate role hierarchy
    if (!validateRoleHierarchy(newRole, existingRoles)) {
      return NextResponse.json(
        { error: "Invalid role hierarchy" },
        { status: 400 }
      );
    }

    const roleId = await insertOne("roles", newRole);

    return NextResponse.json({ roleId });
  } catch (error) {
    console.error("Error creating role:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleGet(req: NextRequest) {
  try {
    const tenantId = req.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID is required" },
        { status: 400 }
      );
    }

    const roles = await find<Role>("roles", {
      tenantId: new ObjectId(tenantId),
    });

    return NextResponse.json(roles);
  } catch (error) {
    console.error("Error getting roles:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleUpdate(req: NextRequest) {
  try {
    const tenantId = req.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID is required" },
        { status: 400 }
      );
    }

    const data = await req.json();
    const { roleId, name, description, permissions, hierarchy } = data;

    // Validate required fields
    if (!roleId || !name || !description || !permissions || !hierarchy) {
      return NextResponse.json(
        { error: "Role ID, name, description, permissions, and hierarchy are required" },
        { status: 400 }
      );
    }

    // Validate permissions
    const validPermissions = await find<Permission>("permissions", {
      tenantId: new ObjectId(tenantId),
      name: { $in: permissions },
    });

    if (validPermissions.length !== permissions.length) {
      return NextResponse.json(
        { error: "Invalid permissions" },
        { status: 400 }
      );
    }

    // Get existing roles
    const existingRoles = await find<Role>("roles", {
      tenantId: new ObjectId(tenantId),
      _id: { $ne: new ObjectId(roleId) },
    });

    // Create updated role
    const updatedRole: Omit<Role, "_id"> = {
      tenantId: new ObjectId(tenantId),
      name,
      description,
      permissions,
      hierarchy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Validate role hierarchy
    if (!validateRoleHierarchy(updatedRole, existingRoles)) {
      return NextResponse.json(
        { error: "Invalid role hierarchy" },
        { status: 400 }
      );
    }

    // Update role
    const success = await updateOne(
      "roles",
      { _id: new ObjectId(roleId) },
      {
        $set: {
          name,
          description,
          permissions,
          hierarchy,
          updatedAt: new Date(),
        },
      }
    );

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update role" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating role:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleDelete(req: NextRequest) {
  try {
    const tenantId = req.headers.get("x-tenant-id");
    if (!tenantId) {
      return NextResponse.json(
        { error: "Tenant ID is required" },
        { status: 400 }
      );
    }

    const data = await req.json();
    const { roleId } = data;

    // Check if role is in use
    const usersWithRole = await find("users", {
      tenantId: new ObjectId(tenantId),
      roles: { $in: [roleId] },
    });

    if (usersWithRole.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete role that is assigned to users" },
        { status: 400 }
      );
    }

    // Delete role
    const success = await deleteOne("roles", {
      _id: new ObjectId(roleId),
    });

    if (!success) {
      return NextResponse.json(
        { error: "Failed to delete role" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting role:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const POST = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "role", action: "manage" }],
});

export const GET = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "role", action: "read" }],
});

export const PUT = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "role", action: "manage" }],
});

export const DELETE = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "role", action: "manage" }],
}); 