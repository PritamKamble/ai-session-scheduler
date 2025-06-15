import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { MongoClient } from 'mongodb';
import OpenAI from 'openai';

const ADMIN_EMAIL = "7276279026.pk@gmail.com";
const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.oexqzcj.mongodb.net/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.userId;
    const userEmail = session?.sessionClaims?.email as string | undefined;

    if (!userId || userEmail !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const client = await MongoClient.connect(uri);
    const db = client.db(process.env.MONGO_DATABASE);

    // Get all students with their skills
    const students = await db.collection('student_skills').find().toArray();

    // Generate teaching schedule using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: `You are an expert programming instructor. Create a teaching schedule that groups students with similar skill levels and learning needs.
          Format the response as a JSON object with the following structure:
          {
            "weeks": [
              {
                "week": number,
                "topics": string[],
                "students": string[],
                "learningObjectives": string[],
                "resources": string[]
              }
            ],
            "summary": {
              "totalWeeks": number,
              "totalStudents": number,
              "keyFocusAreas": string[]
            }
          }`
        },
        {
          role: "user",
          content: `Create a teaching schedule for these students and their skills: ${JSON.stringify(students)}`
        }
      ],
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error('No content received from OpenAI');
    }
    const schedule = JSON.parse(content);

    // Save the teaching schedule
    await db.collection('teaching_schedules').insertOne({
      schedule,
      createdAt: new Date(),
    });

    await client.close();

    return NextResponse.json({ schedule });
  } catch (error) {
    console.error('Error generating teaching schedule:', error);
    return NextResponse.json(
      { error: 'Failed to generate teaching schedule' },
      { status: 500 }
    );
  }
} 