import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { insertOne, findOne, find, updateOne } from "@/lib/db";
import { createProtectedApiHandler } from "@/lib/auth/api-protection";
import { initializeTenant, validateTenantSlug } from "@/lib/auth/tenant-init";
import { Tenant } from "@/lib/db/schemas";

async function handler(req: NextRequest) {
  const { method } = req;

  switch (method) {
    case "POST":
      return handleCreate(req);
    case "GET":
      return handleGet(req);
    case "PUT":
      return handleUpdate(req);
    default:
      return NextResponse.json(
        { error: "Method not allowed" },
        { status: 405 }
      );
  }
}

async function handleCreate(req: NextRequest) {
  try {
    const data = await req.json();
    const { name, slug, settings } = data;

    // Validate required fields
    if (!name || !slug) {
      return NextResponse.json(
        { error: "Name and slug are required" },
        { status: 400 }
      );
    }

    // Validate slug
    const isValidSlug = await validateTenantSlug(slug);
    if (!isValidSlug) {
      return NextResponse.json(
        { error: "Invalid or taken slug" },
        { status: 400 }
      );
    }

    // Create tenant
    const tenantId = await initializeTenant(name, slug, settings || {
      allowedDomains: [],
      maxUsers: 10,
      features: [],
    });

    return NextResponse.json({ tenantId });
  } catch (error) {
    console.error("Error creating tenant:", error);
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

    const tenant = await findOne<Tenant>("tenants", {
      _id: new ObjectId(tenantId),
    });

    if (!tenant) {
      return NextResponse.json(
        { error: "Tenant not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(tenant);
  } catch (error) {
    console.error("Error getting tenant:", error);
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
    const { name, settings } = data;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    // Update tenant
    const success = await updateOne(
      "tenants",
      { _id: new ObjectId(tenantId) },
      {
        $set: {
          name,
          settings,
          updatedAt: new Date(),
        },
      }
    );

    if (!success) {
      return NextResponse.json(
        { error: "Failed to update tenant" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating tenant:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const POST = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "tenant", action: "manage" }],
});

export const GET = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "tenant", action: "read" }],
});

export const PUT = createProtectedApiHandler(handler, {
  requiredPermissions: [{ resource: "tenant", action: "manage" }],
}); 