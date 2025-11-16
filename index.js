import {
    Client,
    PrivateKey,
    AccountCreateTransaction,
    Hbar,
    AccountId,
    TopicMessageSubmitTransaction,
    ContractExecuteTransaction,
    ContractFunctionParameters,
    ContractCreateFlow,
    TokenAssociateTransaction, TokenMintTransaction, TransferTransaction,
    TransactionId,
    ContractCreateTransaction,
    FileCreateTransaction,
    FileAppendTransaction,
    ContractId
} from "@hashgraph/sdk";
import express from "express";
import * as dotenv from "dotenv";
import axios from "axios";
import { v4 as uuidv4 } from 'uuid';
import fs from "fs";
import solc from "solc";
import { createNftCollection } from './nft-creator.js';
import { sendEmail } from "./email_system/email_config.js";
import path from "path";
import { connectDB } from './db/connection.js';
import { Profile, Gig, Message, XP, Reward, Application, Invitation, Review, Project } from './db/models.js';
import applicationsRouter from './routes/applications.js';
import invitationsRouter from './routes/invitations.js';
import reviewsRouter from './routes/reviews.js';
import profilesRouter from './routes/profiles.js';
import gigsRouter from './routes/gigs.js';
import messagesRouter from './routes/messages.js';
import freelancersRouter from './routes/freelancers.js';
import rewardsRouter from './routes/rewards.js';
import arbiterRouter from './routes/arbiter.js';
import aiRouter from './routes/ai.routes.js';
import { syncFromMirrorNode as runHcsSync } from './services/hcsSync.service.js';
import { errorHandler } from './middleware/errorHandler.js';

// --- 1. INITIAL SETUP & CONFIGURATION ---
dotenv.config();
const app = express();
app.use(express.json());

// Mount route modules
// API Routes
app.use('/api/applications', applicationsRouter);
app.use('/api/invitations', invitationsRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/freelancers', freelancersRouter);
app.use('/api/ai', aiRouter);

// Mount other routes
app.use('/applications', applicationsRouter);
app.use('/invitations', invitationsRouter);
app.use('/reviews', reviewsRouter);
app.use('/freelancers', freelancersRouter);
// Mount refactored route modules at root to keep exact paths intact
app.use('/', profilesRouter);
app.use('/', gigsRouter);
app.use('/', messagesRouter);
app.use('/', rewardsRouter);
app.use('/', arbiterRouter);

const myAccountId = process.env.TREASURY_ACCOUNT_ID;
const myPrivateKey = process.env.TREASURY_PRIVATE_KEY;
const profileTopicId = process.env.HIRECHAIN_PROFILE_TOPIC_ID;
const gigsTopicId = process.env.HIRECHAIN_GIGS_TOPIC_ID;
const messagesTopicId = process.env.HIRECHAIN_MESSAGES_TOPIC_ID;

if (!myAccountId || !myPrivateKey || !profileTopicId || !gigsTopicId || !messagesTopicId) {
    throw new Error("All required environment variables must be present");
}

// Main client for platform-paid transactions
const platformClient = Client.forTestnet();
platformClient.setOperator(AccountId.fromString(myAccountId), PrivateKey.fromStringECDSA(myPrivateKey));

// Compile the escrow smart contract
const contractSource = fs.readFileSync(path.join(".", "Escrow.sol"), "utf8");
const input = { language: "Solidity", sources: { "Escrow.sol": { content: contractSource } }, settings: { outputSelection: { "*": { "*": ["*"] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const bytecode = output.contracts["Escrow.sol"]["HireChainEscrow"].evm.bytecode.object;

// =================================================================
// --- HELPER FUNCTIONS ---
// =================================================================

async function getEntityIdFromTransaction(transactionId) {
    const input = transactionId;
    const regex = /@(\d+)\.(\d+)/;
    const replacement = '-$1-$2';

    const formattedId = input.replace(regex, replacement);
    console.log({ formattedId })
    const url = `https://testnet.mirrornode.hedera.com/api/v1/transactions/${formattedId}`;

    console.log(url);

    // Poll the mirror node for a few seconds
    for (let i = 0; i < 5; i++) { // Poll up to 5 times
        try {
            const response = await axios.get(url);
            // console.log({ response })

            // Check if the transaction was successful and has an entity_id
            if (response.data && response.data?.transactions && response.data?.transactions[0]?.entity_id) {
                console.log(`- Found entity_id: ${response.data.transactions[0]?.entity_id}`);
                return response.data.transactions[0]?.entity_id;
            } else {
                throw new Error(`Transaction failed with status: ${response.data.result}`);
            }
        } catch (error) {
            if (error.response && error.response.status === 404) {
                // Not found yet, wait and try again
                console.log(`- Transaction not found yet (attempt ${i + 1})... waiting 2s.`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                // A different error occurred
                throw error;
            }
        }
    }

    throw new Error(`Could not find a successful transaction record for ${transactionId} after multiple attempts.`);
}


/**
 * Fetches all historical messages from a Hedera Consensus Service topic via the Mirror Node
 * and processes them to build or update the local state.
 * @param {string} topicId The ID of the HCS topic.
 * @param {function} processor The function to handle each decoded message payload.
 * @returns {Promise<number>} The number of messages processed.
 */
const fetchAndProcessTopicMessages = async (topicId, processor) => {
    const MIRROR_NODE_URL = `https://testnet.mirrornode.hedera.com/api/v1`;
    let nextUrl = `${MIRROR_NODE_URL}/topics/${topicId}/messages?limit=100`;
    let processedCount = 0;

    // Use a while loop to handle pagination
    while (nextUrl) {
        try {
            const response = await axios.get(nextUrl);
            const messages = response.data.messages;

            for (const msg of messages) {
                const messageString = Buffer.from(msg.message, "base64").toString("utf-8");
                try {
                    const messageJson = JSON.parse(messageString);
                    processor(messageJson, msg);
                    processedCount++;
                } catch (e) {
                    // Ignore messages that aren't valid JSON
                }
            }

            // Check for the next page of results
            nextUrl = response.data.links?.next ? `${MIRROR_NODE_URL}${response.data.links.next}` : null;
        } catch (error) {
            console.error(`Error fetching messages for topic ${topicId}:`, error.message);
            break; // Stop on error to prevent infinite loops
        }
    }
    return processedCount;
};

/**
 * Orchestrates the synchronization of MongoDB with the latest state from HCS.
 */
const syncFromMirrorNode = async () => {
    console.log("--- Starting HCS Synchronization ---");

    // 1. Gigs Synchronization (Handles both creation and updates)
    const gigsMap = new Map();
    const gigsProcessor = (message) => {
        if (message.type === "GIG_CREATE") {
            gigsMap.set(message.gigRefId, {
                ...message,
                status: "OPEN",
                visibility: message.visibility || "PUBLIC", // Default to PUBLIC for backward compatibility
                escrowContractId: null,
                assignedFreelancerId: null
            });
        } else if (message.type === "GIG_UPDATE" && gigsMap.has(message.gigRefId)) {
            // Apply updates to the existing gig state
            const existing = gigsMap.get(message.gigRefId);
            gigsMap.set(message.gigRefId, { ...existing, ...message });
        }
    };
    const gigsCount = await fetchAndProcessTopicMessages(gigsTopicId, gigsProcessor);

    // Bulk upsert to MongoDB
    const gigsBulkOps = Array.from(gigsMap.values()).map(gig => ({
        updateOne: {
            filter: { gigRefId: gig.gigRefId },
            update: { $set: gig },
            upsert: true
        }
    }));
    if (gigsBulkOps.length > 0) {
        await Gig.bulkWrite(gigsBulkOps);
    }
    console.log(`[GIGS] Synced ${gigsCount} HCS messages. ${gigsMap.size} unique gigs loaded.`);

    // 2. Profiles Synchronization
    const profilesMap = new Map();
    const profilesProcessor = (message) => {
        if (message.type === "PROFILE_CREATE") {
            profilesMap.set(message.userAccountId, message);
        }
    };
    const profilesCount = await fetchAndProcessTopicMessages(profileTopicId, profilesProcessor);

    // Bulk upsert to MongoDB
    const profilesBulkOps = Array.from(profilesMap.values()).map(profile => ({
        updateOne: {
            filter: { userAccountId: profile.userAccountId },
            update: { $set: profile },
            upsert: true
        }
    }));
    if (profilesBulkOps.length > 0) {
        console.log({ profilesBulkOps })
        await Profile.bulkWrite(profilesBulkOps);
    }
    console.log(`[PROFILES] Synced ${profilesCount} HCS messages. ${profilesMap.size} unique profiles loaded.`);

    // 3. Messages Synchronization
    const messagesArray = [];
    const messagesProcessor = (message) => {
        if (message.type === "GIG_MESSAGE" && message.gigRefId) {
            messagesArray.push(message);
        }
    };
    const messagesCount = await fetchAndProcessTopicMessages(messagesTopicId, messagesProcessor);

    // Clear existing messages and insert new ones
    await Message.deleteMany({});
    if (messagesArray.length > 0) {
        await Message.insertMany(messagesArray, { ordered: false }).catch(err => {
            // Ignore duplicate key errors
            if (err.code !== 11000) throw err;
        });
    }
    console.log(`[MESSAGES] Synced ${messagesCount} HCS messages.`);

    console.log("--- HCS Synchronization Complete ---");
};

/**
 * Defines the NFT reward tiers for the platform.
 */
const rewardTiers = {
    BRONZE_BADGE: {
        xpRequired: 100,
        tokenId: null,
        name: "HireChain Bronze Badge",
        symbol: "HCBF",
        envVar: "HIRECHAIN_BRONZE_BADGE_TOKEN_ID"
    },
    SILVER_BADGE: {
        xpRequired: 500,
        tokenId: null,
        name: "HireChain Silver Badge",
        symbol: "HCSF",
        envVar: "HIRECHAIN_SILVER_BADGE_TOKEN_ID"
    },
    GOLD_BADGE: {
        xpRequired: 2000,
        tokenId: null,
        name: "HireChain Gold Badge",
        symbol: "HCGF",
        envVar: "HIRECHAIN_GOLD_BADGE_TOKEN_ID"
    },
};

/**
 * Idempotent function to initialize NFT collections.
 * It checks for existing Token IDs in .env and only creates them if they are missing.
 */
const initializeNftCollections = async () => {
    console.log("--- Initializing/Loading NFT Collections ---");
    const supplyKey = PrivateKey.fromStringECDSA(myPrivateKey);

    for (const key in rewardTiers) {
        const tier = rewardTiers[key];
        const existingTokenId = process.env[tier.envVar];

        if (existingTokenId && existingTokenId.length > 0) {
            // If the Token ID is in the .env file, use it.
            tier.tokenId = existingTokenId;
            console.log(`- Loaded ${tier.name} from .env with Token ID: ${tier.tokenId}`);
        } else {
            // If not, create it on the Hedera network.
            console.log(`- Token ID for ${tier.name} not found in .env. Creating new collection...`);
            try {
                const tokenId = await createNftCollection(platformClient, tier.name, tier.symbol, myAccountId, supplyKey);
                tier.tokenId = tokenId;
                // IMPORTANT: Instruct the user to update their .env file
                console.warn(
                    `\n*****************************************************************\n` +
                    `  IMPORTANT: NFT Collection '${tier.name}' created with ID ${tokenId}.\n` +
                    `  Add this to your .env file to avoid creating it again:\n` +
                    `  ${tier.envVar}=${tokenId}\n` +
                    `*****************************************************************\n`
                );
            } catch (error) {
                console.error(`Failed to create NFT for ${tier.name}. Halting startup.`);
                process.exit(1); // Exit if creation fails, as the app can't run without it.
            }
        }
    }
    console.log("--- NFT Collections Initialized ---");
};


// --- STARTUP SEQUENCE ---
const startServer = async () => {
    await connectDB();
    await runHcsSync({ profileTopicId, gigsTopicId, messagesTopicId });
    const xpCount = await XP.countDocuments();
    const rewardsCount = await Reward.countDocuments();
    console.log(`Loaded ${xpCount} XP records and ${rewardsCount} reward records.`);
    await initializeNftCollections();
    if (!process.env.NODE_ENV != "VERCEL") {
        const port = process.env.PORT || 3000;
        app.listen(port, () => console.log(`HireChain backend listening on port ${port}`));
    }
};
startServer();


// Users/Profile endpoints moved to routes/profiles.js


// Gig endpoints moved to routes/gigs.js

// Escrow endpoints moved to routes/gigs.js

// Rewards endpoints moved to routes/rewards.js

// =================================================================
// Read-only endpoints moved to route modules
// Messages endpoints moved to routes/messages.js

// --- ARBITER ENDPOINTS ---
// These are platform-paid, direct-execution endpoints for administrative dispute resolution.

// Arbiter endpoints moved to routes/arbiter.js

// Register centralized error handler last
app.use(errorHandler);