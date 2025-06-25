import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { findOne, updateOne, insertOne } from "@/lib/db";
import { createProtectedApiHandler } from "@/lib/auth/api-protection";
import { Invite, User } from "@/lib/db/schemas";

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  try {
    const data = await req.json();
    const { token, clerkId, email } = data;

    // Validate required fields
    if (!token || !clerkId || !email) {
      return NextResponse.json(
        { error: "Token, Clerk ID, and email are required" },
        { status: 400 }
      );
    }

    // Find invite
    const invite = await findOne<Invite>("invites", {
      token,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    if (!invite) {
      return NextResponse.json(
        { error: "Invalid or expired invite" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await findOne<User>("users", {
      tenantId: invite.tenantId,
      clerkId,
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 400 }
      );
    }

    // Create user
    const user: Omit<User, "_id"> = {
      tenantId: invite.tenantId,
      clerkId,
      email,
      roles: [invite.role],
      permissions: [],
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await insertOne("users", user);

    // Update invite status
    await updateOne(
      "invites",
      { _id: invite._id },
      {
        $set: {
          status: "accepted",
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error accepting invite:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const POST = createProtectedApiHandler(handler, {
  allowPublic: true,
}); 