import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { MongoClient } from 'mongodb';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.oexqzcj.mongodb.net/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;

export async function POST(req: Request) {
  try {
    const session = await auth();
    const userId = session?.userId;
    
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get student's skills from MongoDB
    const client = await MongoClient.connect(uri);
    const db = client.db(process.env.MONGO_DATABASE);
    
    const studentSkills = await db.collection('student_skills')
      .findOne({ userId }, { sort: { createdAt: -1 } });

    if (!studentSkills) {
      await client.close();
      return NextResponse.json({ error: 'No skills found' }, { status: 404 });
    }

    // Generate schedule using OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo", // use turbo
      messages: [
        {
          role: "system",
          content: `You are an expert programming instructor. Create a detailed 12-week learning schedule based on the student's current skills and knowledge gaps. 
                Respond ONLY in valid JSON format, following this structure:

                {
                  "schedule": [
                    {
                      "week": number,
                      "topics": string[],
                      "learningObjectives": string[],
                      "resources": string[],
                      "estimatedHours": number
                    }
                  ],
                  "summary": {
                    "currentLevel": string,
                    "targetLevel": string,
                    "keyFocusAreas": string[],
                    "totalEstimatedHours": number
                  }
                }`
        },
        {
          role: "user",
          content: `Create a learning schedule based on these skills: ${studentSkills.skills}`
        }
      ],
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0].message.content;
    if (!content) {
      throw new Error('No content received from OpenAI');
    }
    const schedule = JSON.parse(content);

    // Save the generated schedule
    await db.collection('student_schedules').insertOne({
      userId,
      schedule,
      createdAt: new Date(),
    });

    await client.close();

    return NextResponse.json({ schedule });
  } catch (error) {
    console.error('Error generating schedule:', error);
    return NextResponse.json(
      { error: 'Failed to generate schedule' },
      { status: 500 }
    );
  }
} 