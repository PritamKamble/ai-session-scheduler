import { MongoClient, Db } from "mongodb";
import { indexes } from "./schemas";

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}

const uri = process.env.MONGODB_URI;
const options = {};

let client;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === "development") {
  // In development mode, use a global variable so that the value
  // is preserved across module reloads caused by HMR (Hot Module Replacement).
  let globalWithMongo = global as typeof globalThis & {
    _mongoClientPromise?: Promise<MongoClient>;
  };

  if (!globalWithMongo._mongoClientPromise) {
    client = new MongoClient(uri, options);
    globalWithMongo._mongoClientPromise = client.connect();
  }
  clientPromise = globalWithMongo._mongoClientPromise;
} else {
  // In production mode, it's best to not use a global variable.
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export default clientPromise;

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db();
}

export async function initializeDb() {
  const db = await getDb();
  
  // Create collections if they don't exist
  const collections = [
    "tenants",
    "users",
    "roles",
    "permissions",
    "invites",
    "accessLogs",
    "skillAssessments",
  ];

  for (const collection of collections) {
    try {
      await db.createCollection(collection);
    } catch (error) {
      // Collection might already exist
      console.log(`Collection ${collection} might already exist:`, error);
    }
  }

  // Create indexes
  for (const [collection, collectionIndexes] of Object.entries(indexes)) {
    try {
      await db.collection(collection).createIndexes(collectionIndexes);
    } catch (error) {
      console.error(`Error creating indexes for ${collection}:`, error);
    }
  }
}

// Utility functions for common database operations
export async function findOne<T>(
  collection: string,
  query: object
): Promise<T | null> {
  const db = await getDb();
  return db.collection(collection).findOne<T>(query);
}

export async function find<T>(
  collection: string,
  query: object,
  options?: object
): Promise<T[]> {
  const db = await getDb();
  return db.collection(collection).find<T>(query, options).toArray();
}

export async function insertOne<T>(
  collection: string,
  document: T
): Promise<string> {
  const db = await getDb();
  const result = await db.collection(collection).insertOne(document);
  return result.insertedId.toString();
}

export async function updateOne(
  collection: string,
  query: object,
  update: object
): Promise<boolean> {
  const db = await getDb();
  const result = await db.collection(collection).updateOne(query, update);
  return result.modifiedCount > 0;
}

export async function deleteOne(
  collection: string,
  query: object
): Promise<boolean> {
  const db = await getDb();
  const result = await db.collection(collection).deleteOne(query);
  return result.deletedCount > 0;
}

export async function count(
  collection: string,
  query: object
): Promise<number> {
  const db = await getDb();
  return db.collection(collection).countDocuments(query);
} 