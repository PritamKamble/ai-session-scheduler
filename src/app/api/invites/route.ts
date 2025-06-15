import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { insertOne, findOne, find, updateOne, deleteOne } from "@/lib/db";
import { createProtectedApiHandler } from "@/lib/auth/api-protection";
import { Invite, Role } from "@/lib/db/schemas";
import { randomBytes } from "crypto";

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
    const { email, role } = data;

    // Validate required fields
    if (!email || !role) {
      return NextResponse.json(
        { error: "Email and role are required" },
        { status: 400 }
      );
    }

    // Validate role
    const validRole = await findOne<Role>("roles", {
      tenantId: new ObjectId(tenantId),
      name: role,
    });

    if (!validRole) {
      return NextResponse.json(
        { error: "Invalid role" },
        { status: 400 }
      );
    }

    // Check if invite already exists
    const existingInvite = await findOne<Invite>("invites", {
      tenantId: new ObjectId(tenantId),
      email,
      status: "pending",
    });

    if (existingInvite) {
      return NextResponse.json(
        { error: "Invite already exists" },
        { status: 400 }
      );
    }

    // Generate token
    const token = randomBytes(32).toString("hex");

    // Create invite
    const invite: Omit<Invite, "_id"> = {
      tenantId: new ObjectId(tenantId),
      email,
      role,
      token,
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const inviteId = await insertOne("invites", invite);

    // TODO: Send email with invite link
    // const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/invite?token=${token}`;
    // await sendInviteEmail(email, inviteLink);

    return NextResponse.json({ inviteId });
  } catch (error) {
    console.error("Error creating invite:", error);
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

    const invites = await find<Invite>("invites", {
      tenantId: new ObjectId(tenantId),
    });

    return NextResponse.json(invites);
  } catch (error) {
    console.error("Error getting invites:", error);
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
    const { inviteId, status } = data;

    // Validate required fields
    if (!inviteId || !status) {
      return NextResponse.json(
        { error: "Invite ID and status are required" },
        { status: 400 }
      );
    }

    // Validate status
    if (!["pending", "accepted", "expired"].includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    // Check if invite exists
    const existingInvite = await findOne<Invite>("invites", {
      _id: new ObjectId(inviteId),
      tenantId: new ObjectId(tenantId),
    });

    if (!existingInvite) {
      return NextResponse.json(
        { error: "Invite not found" },
        { status: 404 }
      );
    }

    // Update invite
    const success = await updateOne(
      "invites",
      { _id: new ObjectId(inviteId) },
      {
        $set: {
          status,
          updatedAt: new Date(),
        },
      }
    );

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update invite" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating invite:", error);
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
    const { inviteId } = data;

    // Delete invite
    const success = await deleteOne("invites", {
      _id: new ObjectId(inviteId),
    });

    if (!success) {
      return NextResponse.json(
        { error: "Failed to delete invite" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting invite:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const POST = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "invite", action: "manage" }],
});

export const GET = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "invite", action: "read" }],
});

export const PUT = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "invite", action: "manage" }],
});

export const DELETE = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "invite", action: "manage" }],
}); 