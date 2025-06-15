import { NextRequest, NextResponse } from "next/server";
import { findOne, find } from "../db";
import { User, Role, Permission } from "../db/schemas";
import { hasPermission, PermissionCheck } from "./permissions";

export interface ProtectedRouteOptions {
  requiredPermissions?: PermissionCheck[];
  allowPublic?: boolean;
}

export async function protectApiRoute(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse>,
  options: ProtectedRouteOptions = {}
) {
  try {
    const { requiredPermissions = [], allowPublic = false } = options;

    // Get user and tenant info from headers
    const userId = req.headers.get("x-user-id");
    const tenantId = req.headers.get("x-tenant-id");
    const userRoles = JSON.parse(req.headers.get("x-user-roles") || "[]");
    const userPermissions = JSON.parse(req.headers.get("x-user-permissions") || "[]");

    // Allow public routes if specified
    if (allowPublic) {
      return handler(req);
    }

    // Check if user is authenticated
    if (!userId || !tenantId) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Get user from database
    const user = await findOne<User>("users", {
      _id: userId,
      tenantId,
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    // Get roles and permissions from database
    const roles = await find<Role>("roles", {
      tenantId,
      name: { $in: userRoles },
    });

    const permissions = await find<Permission>("permissions", {
      tenantId,
      name: { $in: userPermissions },
    });

    // Check required permissions
    for (const permission of requiredPermissions) {
      if (!hasPermission(user, roles, permissions, permission)) {
        return NextResponse.json(
          { error: "Forbidden" },
          { status: 403 }
        );
      }
    }

    // Log access attempt
    await fetch(`${req.nextUrl.origin}/api/logs/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId,
        tenantId,
        path: req.nextUrl.pathname,
        method: req.method,
        roles: userRoles,
        status: 200,
        timestamp: new Date(),
        metadata: {
          ip: req.ip,
          userAgent: req.headers.get("user-agent"),
        },
      }),
    });

    // Call the handler
    return handler(req);
  } catch (error) {
    console.error("API route protection error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Helper function to create protected API route handlers
export function createProtectedApiHandler(
  handler: (req: NextRequest) => Promise<NextResponse>,
  options: ProtectedRouteOptions = {}
) {
  return async (req: NextRequest) => {
    return protectApiRoute(req, handler, options);
  };
} 