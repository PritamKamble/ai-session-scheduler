import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  topic: { type: String, required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  schedule: {
    day: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    date: { type: Date, required: true }
  },
  status: { 
    type: String, 
    enum: ['pending', 'scheduled', 'completed', 'cancelled'], 
    default: 'pending' 
  },
  contextIds: [{ type: String }] // Pinecone context IDs
});

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);