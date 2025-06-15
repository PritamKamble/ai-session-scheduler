const { authMiddleware } = require("@clerk/nextjs/server");
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { findOne } from "./lib/db";
import { User } from "./lib/db/schemas";

interface Tenant {
  _id: string;
  slug: string;
}

export const runtime = 'nodejs';

// This example protects all routes including api/trpc routes
// Please edit this to allow other routes to be public as needed.
// See https://clerk.com/docs/references/nextjs/auth-middleware for more information about configuring your middleware
export default authMiddleware({
  publicRoutes: ["/", "/api/webhook/clerk"],
  async afterAuth(auth: { userId: string | null; isPublicRoute: boolean }, req: NextRequest) {
    // Handle authentication
    if (!auth.userId && !auth.isPublicRoute) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    // Get tenant from subdomain
    const hostname = req.headers.get("host") || "";
    const subdomain = hostname.split(".")[0];
    const isLocalhost = hostname.includes("localhost");

    // Skip tenant check for public routes and localhost
    if (auth.isPublicRoute || isLocalhost) {
      return NextResponse.next();
    }

    // Get user from database
    const user = await findOne<User>("users", {
      clerkId: auth.userId,
    });

    if (!user) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    // Get tenant from database
    const tenant = await findOne<Tenant>("tenants", {
      _id: user.tenantId,
    });

    if (!tenant) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    // Verify tenant matches subdomain
    if (tenant.slug !== subdomain) {
      return NextResponse.redirect(new URL("/sign-in", req.url));
    }

    // Add user and tenant info to request headers
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", user._id.toString());
    requestHeaders.set("x-tenant-id", tenant._id.toString());
    requestHeaders.set("x-user-roles", JSON.stringify(user.roles));
    requestHeaders.set("x-user-permissions", JSON.stringify(user.permissions));

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  },
});

export const config = {
  matcher: ["/((?!.+\\.[\\w]+$|_next).*)", "/", "/(api|trpc)(.*)"],
}; 