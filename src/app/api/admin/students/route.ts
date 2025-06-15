import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { MongoClient } from 'mongodb';

const ADMIN_EMAIL = "7276279026.pk@gmail.com";
const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.oexqzcj.mongodb.net/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;

export async function GET(req: Request) {
  try {
    const session = await auth();
    const userId = session?.userId;
    const userEmail = session?.user?.emailAddresses[0]?.emailAddress;

    if (!userId || userEmail !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await MongoClient.connect(uri);
    const db = client.db(process.env.MONGO_DATABASE);

    // Get all students with their skills and schedules
    const students = await db.collection('student_skills')
      .aggregate([
        {
          $lookup: {
            from: 'student_schedules',
            localField: 'userId',
            foreignField: 'userId',
            as: 'schedule'
          }
        },
        {
          $project: {
            userId: 1,
            skills: 1,
            createdAt: 1,
            schedule: { $arrayElemAt: ['$schedule', 0] }
          }
        }
      ])
      .toArray();

    await client.close();

    return NextResponse.json({ students });
  } catch (error) {
    console.error('Error fetching students:', error);
    return NextResponse.json(
      { error: 'Failed to fetch students' },
      { status: 500 }
    );
  }
} 