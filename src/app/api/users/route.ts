import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { insertOne, findOne, find, updateOne, deleteOne } from "@/lib/db";
import { createProtectedApiHandler } from "@/lib/auth/api-protection";
import { User, Role } from "@/lib/db/schemas";
import { canManageUser } from "@/lib/auth/permissions";

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
    const { clerkId, email, roles, permissions, metadata } = data;

    // Validate required fields
    if (!clerkId || !email || !roles) {
      return NextResponse.json(
        { error: "Clerk ID, email, and roles are required" },
        { status: 400 }
      );
    }

    // Validate roles
    const validRoles = await find<Role>("roles", {
      tenantId: new ObjectId(tenantId),
      name: { $in: roles },
    });

    if (validRoles.length !== roles.length) {
      return NextResponse.json(
        { error: "Invalid roles" },
        { status: 400 }
      );
    }

    // Create user
    const user: Omit<User, "_id"> = {
      tenantId: new ObjectId(tenantId),
      clerkId,
      email,
      roles,
      permissions: permissions || [],
      metadata: metadata || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const userId = await insertOne("users", user);

    return NextResponse.json({ userId });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleGet(req: NextRequest) {
  try {
    const tenantId = req.headers.get("x-tenant-id");
    const userId = req.headers.get("x-user-id");
    if (!tenantId || !userId) {
      return NextResponse.json(
        { error: "Tenant ID and user ID are required" },
        { status: 400 }
      );
    }

    const user = await findOne<User>("users", {
      _id: new ObjectId(userId),
      tenantId: new ObjectId(tenantId),
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Error getting user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleUpdate(req: NextRequest) {
  try {
    const tenantId = req.headers.get("x-tenant-id");
    const userId = req.headers.get("x-user-id");
    if (!tenantId || !userId) {
      return NextResponse.json(
        { error: "Tenant ID and user ID are required" },
        { status: 400 }
      );
    }

    const data = await req.json();
    const { roles, permissions, metadata } = data;

    // Get current user and target user
    const currentUser = await findOne<User>("users", {
      _id: new ObjectId(userId),
      tenantId: new ObjectId(tenantId),
    });

    const targetUser = await findOne<User>("users", {
      _id: new ObjectId(data.targetUserId),
      tenantId: new ObjectId(tenantId),
    });

    if (!currentUser || !targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if current user can manage target user
    const roles = await find<Role>("roles", {
      tenantId: new ObjectId(tenantId),
    });

    if (!canManageUser(currentUser, targetUser, roles, [])) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    // Update user
    const success = await updateOne(
      "users",
      { _id: new ObjectId(data.targetUserId) },
      {
        $set: {
          roles: roles || targetUser.roles,
          permissions: permissions || targetUser.permissions,
          metadata: metadata || targetUser.metadata,
          updatedAt: new Date(),
        },
      }
    );

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update user" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleDelete(req: NextRequest) {
  try {
    const tenantId = req.headers.get("x-tenant-id");
    const userId = req.headers.get("x-user-id");
    if (!tenantId || !userId) {
      return NextResponse.json(
        { error: "Tenant ID and user ID are required" },
        { status: 400 }
      );
    }

    const data = await req.json();
    const { targetUserId } = data;

    // Get current user and target user
    const currentUser = await findOne<User>("users", {
      _id: new ObjectId(userId),
      tenantId: new ObjectId(tenantId),
    });

    const targetUser = await findOne<User>("users", {
      _id: new ObjectId(targetUserId),
      tenantId: new ObjectId(tenantId),
    });

    if (!currentUser || !targetUser) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Check if current user can manage target user
    const roles = await find<Role>("roles", {
      tenantId: new ObjectId(tenantId),
    });

    if (!canManageUser(currentUser, targetUser, roles, [])) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403 }
      );
    }

    // Delete user
    const success = await deleteOne("users", {
      _id: new ObjectId(targetUserId),
    });

    if (!success) {
      return NextResponse.json(
        { error: "Failed to delete user" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const POST = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "user", action: "manage" }],
});

export const GET = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "user", action: "read" }],
});

export const PUT = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "user", action: "manage" }],
});

export const DELETE = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "user", action: "manage" }],
}); 