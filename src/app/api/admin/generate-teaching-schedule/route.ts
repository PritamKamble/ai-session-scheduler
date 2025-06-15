// SSPL License Header
// Copyright (C) 2025 Your Company. All Rights Reserved.
//
// This file is part of the LinkCode Scheduler project, licensed under the Server Side Public License, version 1.
//
// See the SSPL for details: https://www.mongodb.com/licensing/server-side-public-license

import { NextResponse, NextRequest } from 'next/server';
import { getAuth } from '@clerk/nextjs/server';
import { MongoClient } from 'mongodb';
import OpenAI from 'openai';

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.oexqzcj.mongodb.net/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function hasPermission(
  userRoles: string[],
  tenantId: string,
  resource: string,
  action: string
) {
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DATABASE);
  const perms = await db
    .collection('permissions')
    .find({
      tenant_id: tenantId,
      role: { $in: userRoles },
      resource,
      action,
    })
    .toArray();
  await client.close();
  return perms.length > 0;
}

/**
 * POST /api/admin/generate-teaching-schedule
 * @param req NextRequest
 */
export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id') || '';
    const { userId, sessionClaims } = getAuth(req);
    if (!userId)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userRoles: string[] =
      (sessionClaims?.privateMetadata as { roles?: string[] })?.roles || [];
    if (!userRoles.includes('admin') && !userRoles.includes('super_admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const allowed = await hasPermission(
      userRoles,
      tenantId,
      'teaching_schedule',
      'generate'
    );
    if (!allowed)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const client = await MongoClient.connect(uri);
    const db = client.db(process.env.MONGO_DATABASE);
    const students = await db
      .collection('student_skills')
      .find({ tenant_id: tenantId })
      .toArray();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [
        {
          role: 'system',
          content: `You are an expert programming instructor. Create a teaching schedule that groups students with similar skill levels and learning needs.\nFormat the response as a JSON object with the following structure:{\n  "weeks": [\n    {\n      "week": number,\n      "topics": string[],\n      "students": string[],\n      "learningObjectives": string[],\n      "resources": string[]\n    }\n  ],\n  "summary": {\n    "totalWeeks": number,\n    "totalStudents": number,\n    "keyFocusAreas": string[]\n  }\n}`,
        },
        {
          role: 'user',
          content: `Create a teaching schedule for these students and their skills: ${JSON.stringify(
            students
          )}`,
        },
      ],
      response_format: { type: 'json_object' },
    });
    const content = completion.choices[0].message.content;
    if (!content) throw new Error('No content received from OpenAI');
    const schedule = JSON.parse(content);
    await db.collection('teaching_schedules').insertOne({
      tenant_id: tenantId,
      schedule,
      createdAt: new Date(),
    });
    await client.close();
    return NextResponse.json({ schedule });
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate teaching schedule' },
      { status: 500 }
    );
  }
}