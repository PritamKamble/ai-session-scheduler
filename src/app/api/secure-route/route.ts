// SSPL License Header
// Copyright (C) 2025 Your Company. All Rights Reserved.
//
// This file is part of the LinkCode Scheduler project, licensed under the Server Side Public License, version 1.
//
// See the SSPL for details: https://www.mongodb.com/licensing/server-side-public-license

import { NextResponse, NextRequest } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import { MongoClient } from 'mongodb';

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.oexqzcj.mongodb.net/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;

async function hasPermission(userRoles: string[], tenantId: string, resource: string, action: string) {
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DATABASE);
  const perms = await db.collection('permissions').find({
    tenant_id: tenantId,
    role: { $in: userRoles },
    resource,
    action
  }).toArray();
  await client.close();
  return perms.length > 0;
}

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') || '';
  const { userId, sessionClaims } = getAuth(req);
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userRoles: string[] = (sessionClaims?.privateMetadata as { roles?: string[] })?.roles || [];
  if (!userRoles.length) return NextResponse.json({ error: 'No roles assigned' }, { status: 403 });
  const allowed = await hasPermission(userRoles, tenantId, 'secure_resource', 'read');
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ message: 'Access granted' });
}
