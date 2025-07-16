// models/studentAvailability.js
import mongoose from 'mongoose';

const studentAvailabilitySchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  subject: {
    type: String,
    required: true,
    lowercase: true, // Normalize for matching
    trim: true
  },
  availability: [{
    date: { type: Date, required: true },
    day: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    timezone: { type: String, default: 'UTC' }
  }],
  status: {
    type: String,
    enum: ['pending', 'matched', 'expired'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now },
  expiresAt: {
    type: Date,
    default: function() {
      // Expire after 7 days if not matched
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + 7);
      return expiry;
    }
  }
});

// TTL Index for automatic cleanup
studentAvailabilitySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for efficient queries
studentAvailabilitySchema.index({ subject: 1, status: 1 });
studentAvailabilitySchema.index({ studentId: 1, subject: 1 });

// Static method to find students with overlapping availability
studentAvailabilitySchema.statics.findOverlappingAvailability = async function(subject, minStudents = 5) {
  const availabilities = await this.find({
    subject: subject.toLowerCase(),
    status: 'pending'
  }).populate('studentId', 'name email');

  // Group by time windows to find overlaps
  const timeWindows = {};
  
  availabilities.forEach(availability => {
    availability.availability.forEach(slot => {
      const key = `${slot.date.toISOString().split('T')[0]}_${slot.startTime}_${slot.endTime}`;
      if (!timeWindows[key]) {
        timeWindows[key] = {
          date: slot.date,
          day: slot.day,
          startTime: slot.startTime,
          endTime: slot.endTime,
          timezone: slot.timezone,
          students: []
        };
      }
      timeWindows[key].students.push({
        studentId: availability.studentId._id,
        name: availability.studentId.name,
        email: availability.studentId.email,
        availabilityId: availability._id
      });
    });
  });

  // Find windows with enough students
  const viableWindows = Object.values(timeWindows).filter(
    window => window.students.length >= minStudents
  );

  return viableWindows;
};

// Method to normalize subjects for better matching
studentAvailabilitySchema.statics.normalizeSubject = function(subject) {
  const normalized = subject.toLowerCase().trim();
  
  // Subject mapping for related topics
  const subjectMap = {
    'react': ['react', 'reactjs', 'react.js', 'react hooks', 'react components'],
    'javascript': ['javascript', 'js', 'vanilla js', 'es6', 'node.js', 'nodejs'],
    'python': ['python', 'python3', 'django', 'flask', 'fastapi'],
    'java': ['java', 'spring', 'spring boot', 'hibernate'],
    'css': ['css', 'css3', 'styling', 'bootstrap', 'tailwind'],
    'html': ['html', 'html5', 'markup', 'web development']
  };
  
  // Find the main subject category
  for (const [mainSubject, variants] of Object.entries(subjectMap)) {
    if (variants.some(variant => normalized.includes(variant))) {
      return mainSubject;
    }
  }
  
  return normalized;
};

export const StudentAvailability = mongoose.models.StudentAvailability || 
  mongoose.model('StudentAvailability', studentAvailabilitySchema);