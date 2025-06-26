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
    enum: ['pending', 'scheduled', 'completed', 'cancelled'], 
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
  }
}, {
  timestamps: true
});

// Index for efficient queries
sessionSchema.index({ teacherId: 1, status: 1 });
sessionSchema.index({ studentIds: 1, status: 1 });
sessionSchema.index({ topic: 'text' });
sessionSchema.index({ 'schedule.date': 1, 'schedule.startTime': 1 });

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

// Pre-save middleware to validate schedule dates
sessionSchema.pre('save', function(next) {
  if (this.schedule && this.schedule.date) {
    const scheduleDate = new Date(this.schedule.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (scheduleDate < today) {
      return next(new Error('Schedule date cannot be in the past'));
    }
  }
  
  // Validate additional slots dates
  if (this.additionalSlots && this.additionalSlots.length > 0) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (const slot of this.additionalSlots) {
      if (new Date(slot.date) < today) {
        return next(new Error('Additional slot dates cannot be in the past'));
      }
    }
  }
  
  next();
});

// Pre-save middleware to ensure proper student enrollment
sessionSchema.pre('save', function(next) {
  // Remove duplicate student IDs
  if (this.studentIds && this.studentIds.length > 0) {
    this.studentIds = [...new Set(this.studentIds.map(id => id.toString()))].map(id => new mongoose.Types.ObjectId(id));
  }
  next();
});

export const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);