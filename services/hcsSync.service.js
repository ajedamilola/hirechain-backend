import axios from 'axios';
import { Gig, Profile, Message } from '../db/models.js';

/**
 * Fetches all historical messages from a Hedera Consensus Service topic via the Mirror Node
 * and processes them to build or update the local state.
 * @param {string} topicId The ID of the HCS topic.
 * @param {function(Object, Object):void} processor Function to handle each decoded message payload.
 * @returns {Promise<number>} The number of messages processed.
 */
export const fetchAndProcessTopicMessages = async (topicId, processor) => {
  const MIRROR_NODE_URL = `https://testnet.mirrornode.hedera.com/api/v1`;
  let nextUrl = `${MIRROR_NODE_URL}/topics/${topicId}/messages?limit=100`;
  let processedCount = 0;

  while (nextUrl) {
    try {
      const response = await axios.get(nextUrl);
      const messages = response.data.messages;

      for (const msg of messages) {
        const messageString = Buffer.from(msg.message, 'base64').toString('utf-8');
        try {
          const messageJson = JSON.parse(messageString);
          processor(messageJson, msg);
          processedCount++;
        } catch (_) {
          // ignore non-JSON messages
        }
      }

      nextUrl = response.data.links?.next ? `${MIRROR_NODE_URL}${response.data.links.next}` : null;
    } catch (error) {
      console.error(`Error fetching messages for topic ${topicId}:`, error.message);
      break;
    }
  }
  return processedCount;
};

/**
 * Orchestrates the synchronization of MongoDB with the latest state from HCS.
 * Keeps backward compatibility by defaulting visibility to PUBLIC when missing.
 */
export const syncFromMirrorNode = async ({ profileTopicId, gigsTopicId, messagesTopicId }) => {
  console.log('--- Starting HCS Synchronization ---');

  // 1. Gigs
  const gigsMap = new Map();
  const gigsProcessor = (message) => {
    if (message.type === 'GIG_CREATE') {
      gigsMap.set(message.gigRefId, {
        ...message,
        status: 'OPEN',
        visibility: message.visibility || 'PUBLIC',
        escrowContractId: null,
        assignedFreelancerId: null,
      });
    } else if (message.type === 'GIG_UPDATE' && gigsMap.has(message.gigRefId)) {
      const existing = gigsMap.get(message.gigRefId);
      gigsMap.set(message.gigRefId, { ...existing, ...message });
    }
  };
  const gigsCount = await fetchAndProcessTopicMessages(gigsTopicId, gigsProcessor);

  const gigsBulkOps = Array.from(gigsMap.values()).map((gig) => ({
    updateOne: {
      filter: { gigRefId: gig.gigRefId },
      update: { $set: gig },
      upsert: true,
    },
  }));
  if (gigsBulkOps.length > 0) await Gig.bulkWrite(gigsBulkOps);
  console.log(`[GIGS] Synced ${gigsCount} HCS messages. ${gigsMap.size} unique gigs loaded.`);

  // 2. Profiles
  const profilesMap = new Map();
  const profilesProcessor = (message) => {
    if (message.type === 'PROFILE_CREATE') {
      profilesMap.set(message.userAccountId, message);
    }
  };
  const profilesCount = await fetchAndProcessTopicMessages(profileTopicId, profilesProcessor);

  const profilesBulkOps = Array.from(profilesMap.values()).map((profile) => ({
    updateOne: {
      filter: { userAccountId: profile.userAccountId },
      update: { $set: profile },
      upsert: true,
    },
  }));
  if (profilesBulkOps.length > 0) await Profile.bulkWrite(profilesBulkOps);
  console.log(`[PROFILES] Synced ${profilesCount} HCS messages. ${profilesMap.size} unique profiles loaded.`);

  // 3. Messages
  const messagesArray = [];
  const messagesProcessor = (message) => {
    if (message.type === 'GIG_MESSAGE' && message.gigRefId) {
      messagesArray.push(message);
    }
  };
  const messagesCount = await fetchAndProcessTopicMessages(messagesTopicId, messagesProcessor);

  await Message.deleteMany({});
  if (messagesArray.length > 0) {
    await Message.insertMany(messagesArray, { ordered: false }).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }
  console.log(`[MESSAGES] Synced ${messagesCount} HCS messages.`);

  console.log('--- HCS Synchronization Complete ---');
};
