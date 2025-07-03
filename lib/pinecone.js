// lib/pinecone.js
import { Pinecone } from '@pinecone-database/pinecone';
import { Context } from '@/models/context';
// Initialize Pinecone client
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY
});

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || 'conversations';

// Get or create index
async function getIndex() {
  try {
    const index = pinecone.index(INDEX_NAME);
    return index;
  } catch (error) {
    console.error('Error accessing Pinecone index:', error);
    throw new Error('Failed to access Pinecone index');
  }
}

/**
 * Query Pinecone vector store for similar sessions
 * @param {Object} params - Query parameters
 * @param {string} params.userId - User ID for namespace isolation
 * @param {number[]} params.embedding - Query embedding vector
 * @param {Object} params.filter - Metadata filters
 * @param {number} params.topK - Number of results to return
 * @param {boolean} params.includeMetadata - Whether to include metadata
 * @param {number} params.minScore - Minimum similarity score threshold
 * @returns {Promise<Array>} Array of matching sessions
 */
export async function queryPineconeVectorStore({
  userId,
  embedding,
  filter = {},
  topK = 10,
  includeMetadata = true,
  minScore = 0.7
}) {
  try {
    // Validate inputs
    if (!userId) {
      throw new Error('userId is required');
    }
    
    if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('Valid embedding array is required');
    }

    const index = await getIndex();
    
    // Build metadata filter
    const metadataFilter = buildMetadataFilter(filter);
    
    // Query Pinecone
    const queryResponse = await index.query({
      vector: embedding,
      topK,
      includeMetadata,
      namespace: `user-${userId}`, // Namespace isolation per user
      filter: metadataFilter
    });

    // Process and filter results
    const results = queryResponse.matches
      ?.filter(match => match.score >= minScore)
      ?.map(match => ({
        id: match.id,
        score: match.score,
        metadata: match.metadata || {}
      })) || [];

    console.log(`Pinecone query returned ${results.length} results for user ${userId}`);
    
    return results;
    
  } catch (error) {
    console.error('Error querying Pinecone:', error);
    // Return empty array instead of throwing to allow fallback behavior
    return [];
  }
}

/**
 * Upsert session data to Pinecone
 * @param {Object} params - Upsert parameters
 * @param {string} params.userId - User ID for namespace
 * @param {string} params.sessionId - Session ID
 * @param {number[]} params.embedding - Session embedding vector
 * @param {Object} params.metadata - Session metadata
 * @returns {Promise<boolean>} Success status
 */
export async function upsertSessionToPinecone({
  userId,
  sessionId,
  embedding,
  metadata = {}
}) {
  try {
    if (!userId || !sessionId || !embedding) {
      throw new Error('userId, sessionId, and embedding are required');
    }

    const index = await getIndex();
    
    const upsertData = {
      id: sessionId,
      values: embedding,
      metadata: {
        ...metadata,
        userId,
        updatedAt: new Date().toISOString()
      }
    };

    await index.upsert([upsertData], {
      namespace: `user-${userId}`
    });

    console.log(`Successfully upserted session ${sessionId} for user ${userId}`);
    return true;
    
  } catch (error) {
    console.error('Error upserting to Pinecone:', error);
    return false;
  }
}

/**
 * Delete session from Pinecone
 * @param {string} userId - User ID
 * @param {string} sessionId - Session ID to delete
 * @returns {Promise<boolean>} Success status
 */
export async function deleteSessionFromPinecone(userId, sessionId) {
  try {
    if (!userId || !sessionId) {
      throw new Error('userId and sessionId are required');
    }

    const index = await getIndex();
    
    await index.deleteOne(sessionId, {
      namespace: `user-${userId}`
    });

    console.log(`Successfully deleted session ${sessionId} for user ${userId}`);
    return true;
    
  } catch (error) {
    console.error('Error deleting from Pinecone:', error);
    return false;
  }
}

/**
 * Build metadata filter for Pinecone query
 * @param {Object} filter - Filter object
 * @returns {Object} Pinecone-compatible filter
 */
function buildMetadataFilter(filter) {
  const metadataFilter = {};
  
  // Handle different filter types
  Object.entries(filter).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    
    switch (key) {
      case 'status':
        if (Array.isArray(value)) {
          metadataFilter.status = { $in: value };
        } else {
          metadataFilter.status = { $eq: value };
        }
        break;
        
      case 'studentIds':
        if (Array.isArray(value)) {
          metadataFilter.studentIds = { $in: value };
        }
        break;
        
      case 'teacherId':
        metadataFilter.teacherId = { $eq: value };
        break;
        
      case 'topic':
        if (typeof value === 'object' && value.$regex) {
          // For regex searches, we'll handle this in post-processing
          // as Pinecone doesn't support regex in metadata filters
          metadataFilter.topic = { $exists: true };
        } else {
          metadataFilter.topic = { $eq: value };
        }
        break;
        
      case 'date':
        if (typeof value === 'object' && (value.$gte || value.$lte)) {
          metadataFilter.date = value;
        } else {
          metadataFilter.date = { $eq: value };
        }
        break;
        
      default:
        metadataFilter[key] = { $eq: value };
    }
  });
  
  return metadataFilter;
}

/**
 * Generate embedding for session content using context data
 * @param {Object} sessionData - Session data to embed
 * @param {Object} contextData - Related context data (optional)
 * @returns {Promise<number[]>} Embedding vector
 */
export async function generateSessionEmbedding(sessionData, contextData = null) {
  try {
    // If context data is provided and has embedding, use it
    if (contextData?.embedding?.length > 0) {
      return contextData.embedding;
    }
    
    // Otherwise, combine relevant session fields for embedding
    const textContent = [
      sessionData.topic || '',
      sessionData.description || '',
      sessionData.status || '',
      ...(sessionData.tags || []),
      // Include context message if available
      ...(contextData?.message ? [contextData.message] : [])
    ].filter(Boolean).join(' ');
    
    // You'll need to implement this based on your embedding service
    // Example using OpenAI embeddings:
    /*
    const response = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: textContent,
    });
    
    return response.data[0].embedding;
    */
    
    // Placeholder - replace with your actual embedding generation
    throw new Error('Embedding generation not implemented. Please integrate with your embedding service.');
    
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Create or update context embedding in database
 * @param {Object} params - Context parameters
 * @param {string} params.userId - User ID (ObjectId string)
 * @param {string} params.role - User role ('teacher' or 'student')
 * @param {string} params.message - Context message
 * @param {string} params.sessionId - Session ID (optional)
 * @param {Object} params.metadata - Additional metadata
 * @returns {Promise<Object>} Created context document
 */
export async function createContextWithEmbedding({
  userId,
  role,
  message,
  sessionId = null,
  metadata = {}
}) {
  try {
    // Generate embedding for the message
    const embedding = await generateSessionEmbedding({ 
      topic: message,
      description: metadata.extractedData?.description || ''
    });
    
    // Create context document matching your schema
    const contextData = {
      userId: new mongoose.Types.ObjectId(userId),
      role,
      message,
      embedding,
      metadata: {
        intent: metadata.intent || 'general',
        extractedData: metadata.extractedData || {}
      },
      ...(sessionId && { sessionId: new mongoose.Types.ObjectId(sessionId) })
    };
    

    
    const context = new Context(contextData);
    await context.save();
    
    return context.toObject();
    
  } catch (error) {
    console.error('Error creating context with embedding:', error);
    throw error;
  }
}

/**
 * Batch process sessions for Pinecone indexing using existing context data
 * @param {Array} sessions - Array of session objects
 * @param {string} userId - User ID
 * @param {Array} contexts - Array of context objects (optional)
 * @returns {Promise<Object>} Processing results
 */
export async function batchProcessSessions(sessions, userId, contexts = []) {
  const results = {
    successful: 0,
    failed: 0,
    errors: []
  };
  
  try {
    const batchSize = 100; // Pinecone batch limit
    
    // Create a map of session-related contexts
    const contextMap = new Map();
    contexts.forEach(context => {
      if (context.sessionId) {
        contextMap.set(context.sessionId.toString(), context);
      }
    });
    
    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);
      
      const upsertPromises = batch.map(async (session) => {
        try {
          // Look for related context
          const relatedContext = contextMap.get(session._id.toString());
          
          let embedding;
          if (relatedContext?.embedding?.length > 0) {
            // Use existing context embedding
            embedding = relatedContext.embedding;
          } else {
            // Generate new embedding
            embedding = await generateSessionEmbedding(session, relatedContext);
          }
          
          // Build metadata that aligns with your Context schema structure
          const metadata = {
            status: session.status,
            topic: session.topic,
            teacherId: session.teacherId?.toString(),
            studentIds: session.studentIds?.map(id => id.toString()) || [],
            date: session.schedule?.date?.toISOString(),
            createdAt: session.createdAt?.toISOString(),
            // Include context metadata if available
            ...(relatedContext?.metadata && {
              contextIntent: relatedContext.metadata.intent,
              contextMessage: relatedContext.message?.substring(0, 100) // Truncate for metadata
            })
          };
          
          await upsertSessionToPinecone({
            userId,
            sessionId: session._id.toString(),
            embedding,
            metadata
          });
          
          results.successful++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            sessionId: session._id,
            error: error.message
          });
        }
      });
      
      await Promise.all(upsertPromises);
    }
    
  } catch (error) {
    console.error('Batch processing error:', error);
    results.errors.push({ general: error.message });
  }
  
  return results;
}