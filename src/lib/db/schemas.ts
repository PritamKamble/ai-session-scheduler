import { ObjectId } from "mongodb";

export interface Tenant {
  _id: ObjectId;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
  settings: {
    allowedDomains: string[];
    maxUsers: number;
    features: string[];
  };
}

export interface User {
  _id: ObjectId;
  tenantId: ObjectId;
  clerkId: string;
  email: string;
  roles: string[];
  permissions: string[];
  metadata: {
    firstName?: string;
    lastName?: string;
    title?: string;
    department?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface Role {
  _id: ObjectId;
  tenantId: ObjectId;
  name: string;
  description: string;
  permissions: string[];
  hierarchy: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Permission {
  _id: ObjectId;
  tenantId: ObjectId;
  name: string;
  description: string;
  resource: string;
  action: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invite {
  _id: ObjectId;
  tenantId: ObjectId;
  email: string;
  role: string;
  token: string;
  status: "pending" | "accepted" | "expired";
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccessLog {
  _id: ObjectId;
  tenantId: ObjectId;
  userId: string;
  path: string;
  method: string;
  roles: string[];
  status: number;
  timestamp: Date;
  metadata: {
    ip?: string;
    userAgent?: string;
    error?: string;
  };
}

export interface SkillAssessment {
  _id: ObjectId;
  tenantId: ObjectId;
  userId: string;
  skills: {
    name: string;
    level: number;
    confidence: number;
  }[];
  assessment: {
    currentLevel: string;
    targetLevel: string;
    keyFocusAreas: string[];
    totalEstimatedHours: number;
  };
  schedule: {
    week: number;
    topics: string[];
    learningObjectives: string[];
    resources: string[];
    estimatedHours: number;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

export const indexes = {
  users: [
    { key: { tenantId: 1, clerkId: 1 }, unique: true },
    { key: { tenantId: 1, email: 1 }, unique: true },
  ],
  roles: [
    { key: { tenantId: 1, name: 1 }, unique: true },
  ],
  permissions: [
    { key: { tenantId: 1, name: 1 }, unique: true },
  ],
  invites: [
    { key: { tenantId: 1, email: 1 }, unique: true },
    { key: { token: 1 }, unique: true },
  ],
  accessLogs: [
    { key: { tenantId: 1, timestamp: -1 } },
    { key: { userId: 1, timestamp: -1 } },
  ],
  skillAssessments: [
    { key: { tenantId: 1, userId: 1 }, unique: true },
  ],
}; 