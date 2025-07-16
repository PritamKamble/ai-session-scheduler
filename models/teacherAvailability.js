import mongoose from 'mongoose';
const teacherAvailabilitySchema = new mongoose.Schema({
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  availability: [{
    date: Date,
    day: String,
    startTime: String,
    endTime: String,
    timezone: String
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export const TeacherAvailability = mongoose.model('TeacherAvailability', teacherAvailabilitySchema);
