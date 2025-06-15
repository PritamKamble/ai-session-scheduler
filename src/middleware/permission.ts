// SSPL License Header
// Copyright (C) 2025 Your Company. All Rights Reserved.
//
// This file is part of the LinkCode Scheduler project, licensed under the Server Side Public License, version 1.
//
// See the SSPL for details: https://www.mongodb.com/licensing/server-side-public-license

import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import { MongoClient } from 'mongodb';

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.oexqzcj.mongodb.net/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;
const IS_SAAS = process.env.IS_SAAS === 'true';

type Role = 'student' | 'instructor' | 'admin' | 'super_admin';

type SessionClaims = {
  privateMetadata?: {
    roles?: Role[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type PermissionContext = {
  userId: string;
  userRoles: Role[];
  tenantId: string;
  permissions: Record<string, unknown>[];
};

interface NextRequestWithPermissionContext extends NextRequest {
  permissionContext?: PermissionContext;
}

export async function permissionMiddleware(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Missing tenant id' }, { status: 400 });

  const { userId, sessionClaims } = getAuth(req) as { userId: string, sessionClaims: SessionClaims };
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userRoles: Role[] = sessionClaims?.privateMetadata?.roles || [];
  if (!userRoles.length) return NextResponse.json({ error: 'No roles assigned' }, { status: 403 });

  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DATABASE);

  if (IS_SAAS) {
    const tenant = await db.collection('tenants').findOne({ tenant_id: tenantId });
    if (!tenant || !tenant.active) {
      await client.close();
      return NextResponse.json({ error: 'Tenant inactive or not found' }, { status: 403 });
    }
    if (tenant.billingStatus !== 'active') {
      await client.close();
      return NextResponse.json({ error: 'Billing inactive' }, { status: 402 });
    }
  }

  const permissions = await db.collection('permissions').find({ tenant_id: tenantId }).toArray();
  await client.close();

  (req as NextRequestWithPermissionContext).permissionContext = { userId, userRoles, tenantId, permissions };
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
