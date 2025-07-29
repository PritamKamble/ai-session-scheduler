import { NextResponse } from 'next/server';
import { User } from '@/models/user';
import connectDB from '@/config/db';

export async function POST(req) {
    try {
        await connectDB();
        const { clerkId, userName, email, firstName, lastName, profileImage, role, metadata } = await req.json();
        console.log(clerkId);
        
        if (!clerkId) {
            return NextResponse.json(
                { error: 'Clerk ID is required' },
                { status: 400 }
            );
        }

        // Determine role
        const teacherEmails = ['7276279026.pk@gmail.com', 'arjun6mahato@gmail.com','akshayynazare@gmail.com','patiljayesh95666@gmail.com'];
        const userRole = teacherEmails.includes(email) ? 'teacher' : (role || 'student');

        // Prepare update data
        const updateData = {
            name: `${firstName} ${lastName}`.trim(),
            email,
            role: userRole,
            metadata: {
                ...(metadata || {}),
                // Ensure arrays exist
                expertise: metadata?.expertise || [],
                availability: metadata?.availability || [],
                enrolledSubjects: metadata?.subjects || [],
                bio: metadata?.bio || ''
            }
        };

        // Add optional fields if they exist
        if (userName) updateData.userName = userName;
        if (profileImage) updateData.profileImage = profileImage;

        // First, try to find existing user by clerkId OR email
        let user = await User.findOne({
            $or: [
                { clerkId },
                { email }
            ]
        });
        console.log(user);
        
        if (user) {
            // Update existing user
            user = await User.findByIdAndUpdate(
                user._id,
                {
                    ...updateData,
                    clerkId // Ensure clerkId is updated in case user was found by email
                },
                { 
                    new: true,
                    runValidators: true
                }
            );
        } else {
            // Create new user
            user = await User.create({
                clerkId,
                ...updateData
            });
        }

        return NextResponse.json({
            success: true,
            user: {
                clerkId: user.clerkId,
                name: user.name,
                email: user.email,
                role: user.role,
                createdAt: user.createdAt,
                profileComplete: !!user.metadata?.bio,
                expertise: user.metadata?.expertise || [],
                enrolledSubjects: user.metadata?.enrolledSubjects || [],
                availability: user.metadata?.availability || []
            }
        });

    } catch (error) {
        console.error('User sync error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}