import { NextRequest, NextResponse } from "next/server";
import { insertOne } from "@/lib/db";
import { createProtectedApiHandler } from "@/lib/auth/api-protection";
import { AccessLog } from "@/lib/db/schemas";

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json(
      { error: "Method not allowed" },
      { status: 405 }
    );
  }

  try {
    const data = await req.json();
    const log: Omit<AccessLog, "_id"> = {
      tenantId: data.tenantId,
      userId: data.userId,
      path: data.path,
      method: data.method,
      roles: data.roles,
      status: data.status,
      timestamp: new Date(data.timestamp),
      metadata: data.metadata,
    };

    await insertOne("accessLogs", log);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error logging access:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export const POST = createProtectedApiHandler(handler, {
  allowPublic: true,
}); 