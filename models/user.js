import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  clerkId: { type: String, unique: true, required: true }, // Add this line
  name: String,
  email: { type: String, unique: true },
  role: { type: String, enum: ['teacher', 'student'], required: true },
  createdAt: { type: Date, default: Date.now },
  metadata: { // Add metadata field to schema
    type: {
      bio: String,
      expertise: [String],
      availability: [{
        day: String,
        startTime: String,
        endTime: String
      }],
      enrolledSubjects: [String]
    },
    default: {}
  }
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);