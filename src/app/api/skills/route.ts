import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { MongoClient } from 'mongodb';

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.oexqzcj.mongodb.net/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.userId;
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { skills } = await req.json();
    if (!skills) {
      return NextResponse.json({ error: 'Skills are required' }, { status: 400 });
    }

    const client = await MongoClient.connect(uri);
    const db = client.db(process.env.MONGO_DATABASE);
    
    // Store skills in MongoDB
    await db.collection('student_skills').insertOne({
      userId,
      skills,
      createdAt: new Date(),
    });

    await client.close();

    return NextResponse.json({ message: 'Skills saved successfully' });
  } catch (error) {
    console.error('Error saving skills:', error);
    return NextResponse.json(
      { error: 'Failed to save skills' },
      { status: 500 }
    );
  }
} 