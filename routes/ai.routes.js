import express from 'express';
import { aiAgentService } from '../services/aiAgent.service.js';
import { Client } from '@hashgraph/sdk';

// Simple validation for Hedera account IDs
function isValidHederaId(accountId) {
  if (!accountId) return false;
  // Basic format validation for Hedera account ID (e.g., 0.0.1234)
  const parts = accountId.split('.');
  return parts.length === 3 && 
         !isNaN(parts[0]) && 
         !isNaN(parts[1]) && 
         !isNaN(parts[2]);
}

const router = express.Router();

// Process AI chat message - Main entry point for all AI interactions
// Web3 style: Users provide their Hedera account ID with each request
router.post('/chat', async (req, res) => {
  try {
    const { 
      message, 
      chatHistory = [],
      accountId // User's Hedera account ID (e.g., '0.0.1234')
    } = req.body;

    // Validate the provided account ID
    if (!accountId || !isValidHederaId(accountId)) {
      return res.status(400).json({ 
        error: 'Valid Hedera account ID is required (e.g., 0.0.1234)' 
      });
    }

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        error: 'Message is required and must be a string' 
      });
    }

    // Process the message through the AI agent with the user's Hedera account ID
    const { response, toolCalls, error } = await aiAgentService.processMessage(
      message, 
      { 
        accountId, // Pass the Hedera account ID as the user identifier
        chatHistory: Array.isArray(chatHistory) ? chatHistory : []
      }
    );

    // In a production environment, you might want to verify a signature
    // from the user's wallet to prove ownership of the account ID

    res.json({
      response,
      toolCalls,
      timestamp: new Date().toISOString(),
      accountId, // Return the account ID for client reference
      ...(error && { error: true })
    });
  } catch (error) {
    console.error('Error in AI chat endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to process message',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get chat history for a user (optional - can be implemented later)
router.get('/chat/history', async (req, res) => {
  try {
    const { accountId } = req.query;
    
    // Validate the provided account ID
    if (!accountId || !isValidHederaId(accountId)) {
      return res.status(400).json({ 
        error: 'Valid Hedera account ID is required as a query parameter (e.g., ?accountId=0.0.1234)' 
      });
    }

    // In a real app, you would fetch this from a database using the accountId
    // For now, return an empty array
    res.json({
      history: [],
      accountId,
      message: 'Chat history is not yet implemented. This will return the chat history for the provided Hedera account.'
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    res.status(500).json({
      error: 'Failed to fetch chat history',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
