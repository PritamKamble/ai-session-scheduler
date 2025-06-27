import mongoose from 'mongoose';

const contextSchema = new mongoose.Schema({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['teacher', 'student'], required: true },
  message: { type: String, required: true },
  embedding: { type: [Number], required: true },
  metadata: {
    intent: String,
    extractedData: mongoose.Schema.Types.Mixed
  },
  timestamp: { type: Date, default: Date.now }
});

export const Context = mongoose.models.Context || mongoose.model('Context', contextSchema);