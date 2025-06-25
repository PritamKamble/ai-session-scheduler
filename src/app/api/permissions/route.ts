import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { insertOne, findOne, find, updateOne, deleteOne } from "@/lib/db";
import { createProtectedApiHandler } from "@/lib/auth/api-protection";
import { Permission } from "@/lib/db/schemas";

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
    const { name, description, resource, action } = data;

    // Validate required fields
    if (!name || !description || !resource || !action) {
      return NextResponse.json(
        { error: "Name, description, resource, and action are required" },
        { status: 400 }
      );
    }

    // Check if permission already exists
    const existingPermission = await findOne<Permission>("permissions", {
      tenantId: new ObjectId(tenantId),
      name,
    });

    if (existingPermission) {
      return NextResponse.json(
        { error: "Permission already exists" },
        { status: 400 }
      );
    }

    // Create permission
    const permission: Omit<Permission, "_id"> = {
      tenantId: new ObjectId(tenantId),
      name,
      description,
      resource,
      action,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const permissionId = await insertOne("permissions", permission);

    return NextResponse.json({ permissionId });
  } catch (error) {
    console.error("Error creating permission:", error);
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

    const permissions = await find<Permission>("permissions", {
      tenantId: new ObjectId(tenantId),
    });

    return NextResponse.json(permissions);
  } catch (error) {
    console.error("Error getting permissions:", error);
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
    const { permissionId, name, description, resource, action } = data;

    // Validate required fields
    if (!permissionId || !name || !description || !resource || !action) {
      return NextResponse.json(
        { error: "Permission ID, name, description, resource, and action are required" },
        { status: 400 }
      );
    }

    // Check if permission exists
    const existingPermission = await findOne<Permission>("permissions", {
      _id: new ObjectId(permissionId),
      tenantId: new ObjectId(tenantId),
    });

    if (!existingPermission) {
      return NextResponse.json(
        { error: "Permission not found" },
        { status: 404 }
      );
    }

    // Check if new name conflicts with existing permission
    if (name !== existingPermission.name) {
      const nameConflict = await findOne<Permission>("permissions", {
        tenantId: new ObjectId(tenantId),
        name,
      });

      if (nameConflict) {
        return NextResponse.json(
          { error: "Permission name already exists" },
          { status: 400 }
        );
      }
    }

    // Update permission
    const success = await updateOne(
      "permissions",
      { _id: new ObjectId(permissionId) },
      {
        $set: {
          name,
          description,
          resource,
          action,
          updatedAt: new Date(),
        },
      }
    );

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update permission" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating permission:", error);
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
    const { permissionId } = data;

    // Check if permission is in use by any role
    const rolesWithPermission = await find("roles", {
      tenantId: new ObjectId(tenantId),
      permissions: { $in: [permissionId] },
    });

    if (rolesWithPermission.length > 0) {
      return NextResponse.json(
        { error: "Cannot delete permission that is assigned to roles" },
        { status: 400 }
      );
    }

    // Delete permission
    const success = await deleteOne("permissions", {
      _id: new ObjectId(permissionId),
    });

    if (!success) {
      return NextResponse.json(
        { error: "Failed to delete permission" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting permission:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const POST = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "permission", action: "manage" }],
});

export const GET = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "permission", action: "read" }],
});

export const PUT = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "permission", action: "manage" }],
});

export const DELETE = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "permission", action: "manage" }],
}); 