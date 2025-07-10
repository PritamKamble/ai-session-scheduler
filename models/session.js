// models/session.js
import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  topic: { 
    type: String, 
    required: true,
    trim: true
  },
  teacherId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  studentIds: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  schedule: {
    day: { 
      type: String, 
      required: true 
    },
    startTime: { 
      type: String, 
      required: true 
    },
    endTime: { 
      type: String, 
      required: true 
    },
    date: { 
      type: Date, 
      required: true 
    },
    timezone: {
      type: String,
      default: 'UTC'
    }
  },
  // Additional slots for teachers who provide multiple time options
  additionalSlots: [{
    day: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    date: { type: Date, required: true },
    timezone: { type: String, default: 'UTC' }
  }],
  teacherAvailability: [{
    day: { type: String, required: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    date: { type: Date, required: true },
    timezone: { type: String, default: 'UTC' }
  }],
  studentTimingPreferences: [{
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    preferences: [{
      day: { type: String, required: true },
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      date: { type: Date, required: true },
      timezone: { type: String, default: 'UTC' }
    }],
    updatedAt: { type: Date, default: Date.now }
  }],
  status: { 
    type: String, 
    enum: ['pending', 'scheduled', 'completed', 'cancelled', 'coordinated'], 
    default: 'pending' 
  },
  contextIds: [{ type: String }], // Pinecone context IDs
  // Session preferences
  preferences: {
    duration: String,
    format: String,
    level: String,
    style: String
  },
  meetingLink: {
    type: String,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  },
  // Add expiration field for automatic deletion
  expiresAt: {
    type: Date,
    default: function() {
      // Set expiration to 1 day after the session date
      const sessionDate = new Date(this.schedule.date);
      sessionDate.setDate(sessionDate.getDate() + 1);
      return sessionDate;
    }
  }
}, {
  timestamps: true
});

// TTL Index for automatic deletion - MongoDB will automatically delete documents when expiresAt is reached
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for efficient queries
sessionSchema.index({ teacherId: 1, status: 1 });
sessionSchema.index({ studentIds: 1, status: 1 });
sessionSchema.index({ topic: 'text' });
sessionSchema.index({ 'schedule.date': 1, 'schedule.startTime': 1 });

// Helper function to normalize date for comparison (removes time component)
function normalizeDate(date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

// Helper function to check if date is in the past
function isDateInPast(date) {
  const today = normalizeDate(new Date());
  const targetDate = normalizeDate(date);
  return targetDate < today;
}

// Method to get all available time slots (main schedule + additional slots)
sessionSchema.methods.getAllAvailableSlots = function() {
  const slots = [this.schedule];
  if (this.additionalSlots && this.additionalSlots.length > 0) {
    slots.push(...this.additionalSlots);
  }
  return slots;
};

// Method to add context ID
sessionSchema.methods.addContextId = function(contextId) {
  if (!this.contextIds.includes(contextId)) {
    this.contextIds.push(contextId);
  }
};

// Method to update expiration date based on session date
sessionSchema.methods.updateExpirationDate = function(daysAfterSession = 1) {
  const sessionDate = new Date(this.schedule.date);
  sessionDate.setDate(sessionDate.getDate() + daysAfterSession);
  this.expiresAt = sessionDate;
};

// Method to extend expiration (useful for completed sessions you want to keep longer)
sessionSchema.methods.extendExpiration = function(additionalDays = 30) {
  const currentExpiry = this.expiresAt || new Date();
  currentExpiry.setDate(currentExpiry.getDate() + additionalDays);
  this.expiresAt = currentExpiry;
};

// Method to disable auto-deletion (set expiresAt to null)
sessionSchema.methods.disableAutoDelete = function() {
  this.expiresAt = null;
};

// Static method to manually clean up expired sessions (backup method)
sessionSchema.statics.cleanupExpiredSessions = async function() {
  const now = new Date();
  const result = await this.deleteMany({
    $or: [
      { 'schedule.date': { $lt: now } },
      { expiresAt: { $lt: now } }
    ]
  });
  return result;
};

// Static method to find sessions expiring soon
sessionSchema.statics.findExpiringSoon = function(days = 3) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  
  return this.find({
    expiresAt: { $lt: futureDate, $gt: new Date() }
  }).populate('teacherId', 'name email').populate('studentIds', 'name email');
};

// Static method to find sessions by topics
sessionSchema.statics.findByTopics = function(topics, excludeUserId = null) {
  const query = {
    $or: [
      { topic: { $in: topics } },
      { topic: { $regex: topics.map(topic => topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), $options: 'i' } }
    ],
    status: 'pending'
  };
  
  if (excludeUserId) {
    query.teacherId = { $ne: excludeUserId };
    query.studentIds = { $ne: excludeUserId };
  }
  
  return this.find(query).populate('teacherId', 'name email').populate('studentIds', 'name email');
};

// Static method to find sessions by teacher
sessionSchema.statics.findByTeacher = function(teacherId, status = null) {
  const query = { teacherId };
  if (status) {
    query.status = status;
  }
  return this.find(query).populate('studentIds', 'name email');
};

// Static method to find sessions by student
sessionSchema.statics.findByStudent = function(studentId, status = null) {
  const query = { studentIds: studentId };
  if (status) {
    query.status = status;
  }
  return this.find(query).populate('teacherId', 'name email').populate('studentIds', 'name email');
};

// Static method to find available sessions (pending with teacher)
sessionSchema.statics.findAvailable = function(topics = null, limit = 10) {
  const query = {
    status: 'pending',
    teacherId: { $exists: true, $ne: null }
  };
  
  if (topics && topics.length > 0) {
    query.$or = [
      { topic: { $in: topics } },
      { topic: { $regex: topics.map(topic => topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), $options: 'i' } }
    ];
  }
  
  return this.find(query)
    .populate('teacherId', 'name email')
    .populate('studentIds', 'name email')
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Pre-save middleware to update expiration date when session date changes
sessionSchema.pre('save', function(next) {
  try {
    // Update expiration date if schedule date is modified
    if (this.isModified('schedule.date')) {
      this.updateExpirationDate();
    }
    
    // For completed sessions, extend expiration to keep them longer
    if (this.isModified('status') && this.status === 'completed') {
      this.extendExpiration(30); // Keep completed sessions for 30 days
    }
    
    // For cancelled sessions, set shorter expiration
    if (this.isModified('status') && this.status === 'cancelled') {
      this.updateExpirationDate(7); // Keep cancelled sessions for 7 days
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to validate schedule dates
sessionSchema.pre('save', function(next) {
  try {
    // Skip validation for updates where status is being changed to completed/cancelled
    if (this.isModified('status') && ['completed', 'cancelled'].includes(this.status)) {
      return next();
    }

    // Validate main schedule date
    if (this.schedule && this.schedule.date) {
      if (isDateInPast(this.schedule.date)) {
        const error = new Error('Schedule date cannot be in the past');
        error.field = 'schedule.date';
        error.value = this.schedule.date;
        return next(error);
      }
    }
    
    // Validate additional slots dates
    if (this.additionalSlots && this.additionalSlots.length > 0) {
      for (let i = 0; i < this.additionalSlots.length; i++) {
        const slot = this.additionalSlots[i];
        if (isDateInPast(slot.date)) {
          const error = new Error(`Additional slot ${i + 1} date cannot be in the past`);
          error.field = `additionalSlots[${i}].date`;
          error.value = slot.date;
          return next(error);
        }
      }
    }

    // Validate teacher availability dates
    if (this.teacherAvailability && this.teacherAvailability.length > 0) {
      for (let i = 0; i < this.teacherAvailability.length; i++) {
        const availability = this.teacherAvailability[i];
        if (isDateInPast(availability.date)) {
          const error = new Error(`Teacher availability ${i + 1} date cannot be in the past`);
          error.field = `teacherAvailability[${i}].date`;
          error.value = availability.date;
          return next(error);
        }
      }
    }

    // Validate student timing preferences dates
    if (this.studentTimingPreferences && this.studentTimingPreferences.length > 0) {
      for (let i = 0; i < this.studentTimingPreferences.length; i++) {
        const studentPref = this.studentTimingPreferences[i];
        if (studentPref.preferences && studentPref.preferences.length > 0) {
          for (let j = 0; j < studentPref.preferences.length; j++) {
            const pref = studentPref.preferences[j];
            if (isDateInPast(pref.date)) {
              const error = new Error(`Student preference ${j + 1} date cannot be in the past`);
              error.field = `studentTimingPreferences[${i}].preferences[${j}].date`;
              error.value = pref.date;
              return next(error);
            }
          }
        }
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to ensure proper student enrollment
sessionSchema.pre('save', function(next) {
  try {
    // Remove duplicate student IDs
    if (this.studentIds && this.studentIds.length > 0) {
      this.studentIds = [...new Set(this.studentIds.map(id => id.toString()))].map(id => new mongoose.Types.ObjectId(id));
    }
    next();
  } catch (error) {
    next(error);
  }
});

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);