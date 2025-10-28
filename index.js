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
    TokenAssociateTransaction, TokenMintTransaction, TransferTransaction
} from "@hashgraph/sdk";
import express from "express";
import * as dotenv from "dotenv";
import axios from "axios";
import { v4 as uuidv4 } from 'uuid';
import fs from "fs";
import solc from "solc";
import { createNftCollection } from './nft-creator.js'; // <-- NEW IMPORT

// --- 1. INITIAL SETUP & CONFIGURATION ---
dotenv.config();
const app = express();
app.use(express.json());

const myAccountId = process.env.TREASURY_ACCOUNT_ID;
const myPrivateKey = process.env.TREASURY_PRIVATE_KEY;
const profileTopicId = process.env.HIRECHAIN_PROFILE_TOPIC_ID;
const gigsTopicId = process.env.HIRECHAIN_GIGS_TOPIC_ID;
const messagesTopicId = process.env.HIRECHAIN_MESSAGES_TOPIC_ID;

if (!myAccountId || !myPrivateKey || !profileTopicId || !gigsTopicId || !messagesTopicId) {
    throw new Error("All required environment variables must be present");
}

// Main client for platform-paid transactions (like creating accounts)
const platformClient = Client.forTestnet();
platformClient.setOperator(AccountId.fromString(myAccountId), PrivateKey.fromStringECDSA(myPrivateKey));

// Compile the escrow smart contract
const contractSource = fs.readFileSync("Escrow.sol", "utf8");
const input = { language: "Solidity", sources: { "Escrow.sol": { content: contractSource } }, settings: { outputSelection: { "*": { "*": ["*"] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const bytecode = output.contracts["Escrow.sol"]["HireChainEscrow"].evm.bytecode.object;

// --- JSON File Constants ---
const PROFILE_DB_FILE = "profiles.json";
const GIGS_DB_FILE = "gigs.json";
const MESSAGES_DB_FILE = "messages.json";
const XP_DB_FILE = "xp.json"; // <-- NEW
const REWARDS_DB_FILE = "rewards.json"; // <-- NEW

// --- Persistent "Database" (Initialized to be populated later) ---
let gigsDB = {};
let profilesDB = {};
let messagesDB = {};
let xpDB = {}; // <-- NEW
let rewardsDB = {}; // <-- NEW: Stores { accountId: ["BRONZE_BADGE"], ... }

// --- Helper for fetching from Mirror Node ---
const MIRROR_NODE_URL = `https://testnet.mirrornode.hedera.com/api/v1`;

// --- File Storage Utility Functions (Synchronous for API simplicity) ---

/**
 * Loads data from a JSON file. Returns an empty object if the file doesn't exist or is invalid.
 * @param {string} filename The name of the JSON file.
 * @returns {object} The parsed JavaScript object.
 */
const loadDB = (filename) => {
    try {
        if (fs.existsSync(filename)) {
            const data = fs.readFileSync(filename, "utf8");
            return JSON.parse(data || "{}");
        }
    } catch (error) {
        console.error(`Error loading ${filename}:`, error);
    }
    return {};
};

/**
 * Saves a JavaScript object to a JSON file.
 * @param {string} filename The name of the JSON file.
 * @param {object} data The object to save.
 */
const saveDB = (filename, data) => {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2), "utf8");
    } catch (error) {
        console.error(`Error saving to ${filename}:`, error);
    }
};


// --- **NEW** HCS Synchronization Function ---

/**
 * Fetches all historical messages from a Hedera Consensus Service topic via the Mirror Node
 * and processes them to build or update the local state.
 * @param {string} topicId The ID of the HCS topic.
 * @param {function} processor The function to handle each decoded message payload.
 * @returns {Promise<number>} The number of messages processed.
 */
const fetchAndProcessTopicMessages = async (topicId, processor) => {
    let nextUrl = `${MIRROR_NODE_URL}/topics/${topicId}/messages?limit=100`;
    let processedCount = 0;

    // Use a while loop to handle pagination (if more than 100 messages exist)
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
                    console.error(`Failed to parse HCS message for topic ${topicId}:`, e);
                }
            }

            // Check for next page
            nextUrl = response.data.links?.next ? `${MIRROR_NODE_URL}${response.data.links.next}` : null;
        } catch (error) {
            console.error(`Error fetching messages for topic ${topicId}:`, error.message);
            break; // Stop on error
        }
    }
    return processedCount;
};

/**
 * Synchronizes local JSON databases with the latest state from the HCS Mirror Node.
 */
const syncFromMirrorNode = async () => {
    console.log("--- Starting HCS Synchronization ---");

    // 1. Gigs Synchronization (Creates and Updates)
    const newGigsDB = {};
    const gigsProcessor = (message) => {
        if (message.type === "GIG_CREATE") {
            // Initialize the gig state
            newGigsDB[message.gigRefId] = {
                ...message,
                status: "OPEN",
                escrowContractId: null,
                assignedFreelancerId: null,
            };
        } else if (message.type === "GIG_UPDATE" && newGigsDB[message.gigRefId]) {
            // Apply updates to the existing gig state
            newGigsDB[message.gigRefId] = {
                ...newGigsDB[message.gigRefId],
                ...message, // Overwrite properties like status, assignedFreelancerId, escrowContractId
            };
        }
    };
    const gigsCount = await fetchAndProcessTopicMessages(gigsTopicId, gigsProcessor);
    gigsDB = newGigsDB; // Replace local DB with fully reconstructed HCS state
    saveDB(GIGS_DB_FILE, gigsDB);
    console.log(`[GIGS] Synced ${gigsCount} HCS messages. ${Object.keys(gigsDB).length} unique gigs loaded.`);


    // 2. Profiles Synchronization (Always a "CREATE" for this use case)
    const newProfilesDB = {};
    const profilesProcessor = (message) => {
        if (message.type === "PROFILE_CREATE") {
            newProfilesDB[message.userAccountId] = message;
        }
    };
    const profilesCount = await fetchAndProcessTopicMessages(profileTopicId, profilesProcessor);
    profilesDB = newProfilesDB;
    saveDB(PROFILE_DB_FILE, profilesDB);
    console.log(`[PROFILES] Synced ${profilesCount} HCS messages. ${Object.keys(profilesDB).length} unique profiles loaded.`);


    // 3. Messages Synchronization (Append only)
    const newMessagesDB = {}; // { gigRefId: [message, message, ...] }
    const messagesProcessor = (message) => {
        if (message.type === "GIG_MESSAGE" && message.gigRefId) {
            if (!newMessagesDB[message.gigRefId]) {
                newMessagesDB[message.gigRefId] = [];
            }
            newMessagesDB[message.gigRefId].push(message);
        }
    };
    const messagesCount = await fetchAndProcessTopicMessages(messagesTopicId, messagesProcessor);
    // Note: Messages are currently sorted by Mirror Node's internal timestamp, which is close to sequence order.
    messagesDB = newMessagesDB;
    saveDB(MESSAGES_DB_FILE, messagesDB);
    console.log(`[MESSAGES] Synced ${messagesCount} HCS messages across ${Object.keys(messagesDB).length} gigs.`);

    console.log("--- HCS Synchronization Complete ---");
};

// --- **NEW** NFT and Rewards Configuration ---
const rewardTiers = {
    BRONZE_BADGE: {
        xpRequired: 100,
        tokenId: null, // Will be populated from .env or creation
        name: "HireChain Bronze Badge",
        symbol: "HCBF",
        envVar: "HIRECHAIN_BRONZE_BADGE_TOKEN_ID" // Maps reward to .env variable
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

const initializeNftCollections = async () => {
    console.log("--- Initializing/Loading NFT Collections ---");
    // The treasury key is the supply key for all NFTs
    const supplyKey = PrivateKey.fromStringECDSA(myPrivateKey);

    for (const key in rewardTiers) {
        const tier = rewardTiers[key];
        const existingTokenId = process.env[tier.envVar];

        if (existingTokenId && existingTokenId.length > 0) {
            // If the Token ID is found in the .env file, use it.
            tier.tokenId = existingTokenId;
            console.log(`- Loaded ${tier.name} from .env with Token ID: ${tier.tokenId}`);
        } else {
            // If the Token ID is NOT in the .env file, create it.
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
                // Exit the process if creation fails, as the system can't function without the tokens.
                process.exit(1);
            }
        }
    }
    console.log("--- NFT Collections Initialized ---");
};

/// --- Execution Block (Before starting server) ---
const startServer = async () => {
    // 1. Sync all data from HCS Mirror Node
    await syncFromMirrorNode();

    // 2. Load our local-only databases
    xpDB = loadDB(XP_DB_FILE);
    rewardsDB = loadDB(REWARDS_DB_FILE);
    console.log(`Loaded ${Object.keys(xpDB).length} XP records and ${Object.keys(rewardsDB).length} reward records.`);

    // 3. Initialize NFT Collections on Hedera
    await initializeNftCollections();

    // 4. Start Express server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
        console.log(`HireChain backend listening on port ${port}`);
    });
};
// Start the synchronization and then the server
startServer();
// --- 2. USER MANAGEMENT ---
app.post("/register", async (req, res) => {
    try {
        const { name, skills, portfolioUrl } = req.body;
        if (!name || !skills) return res.status(400).json({ message: "Name and skills are required." });

        // Step 1: Create the Hedera Account (paid by the platform)
        const newAccountPrivateKey = PrivateKey.generateED25519();
        const newAccountPublicKey = newAccountPrivateKey.publicKey;
        const newAccountTx = await new AccountCreateTransaction().setKeyWithoutAlias(newAccountPublicKey).setInitialBalance(new Hbar(10)).freezeWith(platformClient).execute(platformClient);
        const receipt = await newAccountTx.getReceipt(platformClient);
        const newAccountId = receipt.accountId;
        console.log("Got here")

        // Step 2: Create the On-Chain Profile (paid by the new user's account)
        const profileData = { type: "PROFILE_CREATE", userAccountId: newAccountId.toString(), name, skills, portfolioUrl };
        const profileTx = new TopicMessageSubmitTransaction({ topicId: profileTopicId, message: JSON.stringify(profileData) });

        const userClient = Client.forTestnet();
        userClient.setOperator(newAccountId, newAccountPrivateKey);
        const signedProfileTx = (await profileTx.freezeWith(userClient).sign(newAccountPrivateKey));
        await signedProfileTx.execute(userClient);

        // Store profile in persistent DB for quick access <--- **CHANGE**
        profilesDB[newAccountId.toString()] = profileData;
        saveDB(PROFILE_DB_FILE, profilesDB); // <-- **PERSISTENCE SAVE**

        res.status(201).json({
            message: "User registered successfully!",
            accountId: newAccountId.toString(),
            privateKey: newAccountPrivateKey.toStringRaw(), // Send back to user to store
            profile: profileData
        });
    } catch (error) {
        res.status(500).json({ message: "Registration failed", error: error.toString() });
    }
});
app.post("/test-partial", async (req, res) => {
    const profileTx = new TopicMessageSubmitTransaction({ topicId: "0.0.7149954", message: "This is a fucking test" });
    const userClient = Client.forTestnet();
    const frozenTransaction = profileTx.freezeWith(userClient)
    const encodedTransaction = Buffer.from(frozenTransaction.toBytes()).toString("base64");
    res.send(encodedTransaction)
})

// Get user profile (NEW)
app.get("/users/profile/:accountId", async (req, res) => {
    try {
        const accountId = req.params.accountId;
        // Check persistent DB first (faster)
        if (profilesDB[accountId]) {
            return res.status(200).json(profilesDB[accountId]);
        }

        // Fallback to Mirror Node if not in local cache (and update cache)
        const mirrorNodeUrl = `${MIRROR_NODE_URL}/topics/${profileTopicId}/messages`;
        const response = await axios.get(mirrorNodeUrl);
        const messages = response.data.messages;

        let userProfile = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            const messageString = Buffer.from(messages[i].message, "base64").toString("utf-8");
            try {
                const messageJson = JSON.parse(messageString);
                if (messageJson.type === "PROFILE_CREATE" && messageJson.userAccountId === accountId) {
                    userProfile = messageJson;
                    // Cache it persistently <--- **CHANGE**
                    profilesDB[accountId] = userProfile;
                    saveDB(PROFILE_DB_FILE, profilesDB); // <-- **PERSISTENCE SAVE**
                    break;
                }
            } catch (e) { /* ignore parse errors */ }
        }

        if (userProfile) {
            res.status(200).json(userProfile);
        } else {
            res.status(404).json({ message: "Profile not found for this account." });
        }
    } catch (error) {
        res.status(500).json({ message: "Error fetching profile", error: error.toString() });
    }
});


// --- 3. GIG MANAGEMENT ---
app.post("/gigs", async (req, res) => {
    try {
        const { clientId, clientPrivateKey, title, description, budget } = req.body;
        if (!clientId || !clientPrivateKey || !title || !description || !budget) return res.status(400).json({ message: "Missing required gig fields." });

        const gigRefId = uuidv4(); // Generate a unique ID for this gig
        const gigData = { type: "GIG_CREATE", gigRefId, clientId, title, description, budget: `${budget} HBAR`, status: "OPEN" };
        const transaction = new TopicMessageSubmitTransaction({ topicId: gigsTopicId, message: JSON.stringify(gigData) });

        const userClient = Client.forTestnet().setOperator(clientId, clientPrivateKey);
        const signedTx = await transaction.freezeWith(userClient).sign(PrivateKey.fromStringECDSA(clientPrivateKey));
        const txResponse = await signedTx.execute(userClient);
        const receipt = await txResponse.getReceipt(userClient);

        // Store gig in our persistent DB (keyed by gigRefId) <--- **CHANGE**
        gigsDB[gigRefId] = {
            ...gigData,
            hcsSequenceNumber: receipt.topicSequenceNumber.toString(),
            escrowContractId: null, // Initially no escrow
            assignedFreelancerId: null, // Initially no freelancer
        };
        saveDB(GIGS_DB_FILE, gigsDB); // <-- **PERSISTENCE SAVE**

        res.status(201).json({ message: "Gig created successfully.", gigRefId, receipt });
    } catch (error) {
        res.status(500).json({ message: "Error creating gig", error: error.toString() });
    }
});

// Endpoint to assign a freelancer and create/initialize the escrow (NEW)
app.post("/gigs/:gigRefId/assign", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { clientId, clientPrivateKey, freelancerAccountId } = req.body;

        if (!clientId || !clientPrivateKey || !freelancerAccountId) return res.status(400).json({ message: "Missing client/freelancer details." });
        if (!gigsDB[gigRefId]) return res.status(404).json({ message: "Gig not found." });
        if (gigsDB[gigRefId].clientId !== clientId) return res.status(403).json({ message: "Only the gig owner can assign a freelancer." });
        if (gigsDB[gigRefId].status !== "OPEN") return res.status(400).json({ message: "Gig is not open for assignment." });

        const userClient = Client.forTestnet().setOperator(clientId, clientPrivateKey);

        // 1. Create and initialize the Escrow Contract
        const contractCreateTx = new ContractCreateFlow()
            .setBytecode(bytecode)
            .setGas(10_000_000); // Only deploys the contract logic

        const createResponse = await contractCreateTx.execute(userClient);
        const createReceipt = await createResponse.getReceipt(userClient);
        const newContractId = createReceipt.contractId;

        // Call initEscrow to set client and freelancer
        const initEscrowTx = new ContractExecuteTransaction()
            .setContractId(newContractId)
            .setGas(10_000_000)
            .setFunction("initEscrow", new ContractFunctionParameters().addAddress(AccountId.fromString(freelancerAccountId).toEvmAddress()));

        await (await initEscrowTx.execute(userClient)).getReceipt(userClient);

        // 2. Update Gig Status on HCS to "IN_PROGRESS" and link escrow
        const updateGigData = {
            type: "GIG_UPDATE",
            gigRefId,
            clientId,
            status: "IN_PROGRESS",
            assignedFreelancerId: freelancerAccountId,
            escrowContractId: newContractId.toString(),
            timestamp: new Date().toISOString()
        };
        const updateGigTx = new TopicMessageSubmitTransaction({ topicId: gigsTopicId, message: JSON.stringify(updateGigData) });
        await (await updateGigTx.execute(userClient)).getReceipt(userClient);

        // 3. Update persistent DB <--- **CHANGE**
        gigsDB[gigRefId].status = "IN_PROGRESS";
        gigsDB[gigRefId].assignedFreelancerId = freelancerAccountId;
        gigsDB[gigRefId].escrowContractId = newContractId.toString();
        saveDB(GIGS_DB_FILE, gigsDB); // <-- **PERSISTENCE SAVE**

        res.status(200).json({
            message: "Freelancer assigned and escrow created successfully.",
            gigRefId,
            escrowContractId: newContractId.toString(),
        });

    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Error assigning freelancer/creating escrow", error: error.toString() });
    }
});

// Endpoint to list all gigs (retrieves from persistent DB)
app.get("/gigs", async (req, res) => {
    try {
        // Only return gigs with the status "OPEN"
        const openGigs = Object.values(gigsDB).filter(gig => gig.status === "OPEN");

        res.status(200).json(openGigs);
    } catch (error) {
        res.status(500).json({ message: "Error listing open gigs", error: error.toString() });
    }
});

// NEW: Endpoint to fetch all gigs a specific user is involved in
app.get("/users/:accountId/gigs", async (req, res) => {
    try {
        const { accountId } = req.params;

        if (!accountId) {
            return res.status(400).json({ message: "Account ID is required to fetch owned gigs." });
        }

        // Filter all gigs where the user is either the client or the assigned freelancer
        const userGigs = Object.values(gigsDB).filter(gig =>
            gig.clientId === accountId || gig.assignedFreelancerId === accountId
        );

        res.status(200).json(userGigs);
    } catch (error) {
        res.status(500).json({ message: "Error fetching user-specific gigs", error: error.toString() });
    }
});


// Get a single gig by gigRefId (NEW)
app.get("/gigs/:gigRefId", async (req, res) => {
    const { gigRefId } = req.params;
    if (gigsDB[gigRefId]) {
        return res.status(200).json(gigsDB[gigRefId]);
    }
    res.status(404).json({ message: "Gig not found." });
});


// --- 4. ESCROW MANAGEMENT ---
app.post("/gigs/:gigRefId/lock-escrow", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { clientId, clientPrivateKey, amount } = req.body;
        if (!clientId || !clientPrivateKey || !amount) return res.status(400).json({ message: "Missing required fields." });

        const gig = gigsDB[gigRefId];
        if (!gig || !gig.escrowContractId) return res.status(404).json({ message: "Gig not found or no escrow associated." });
        if (gig.clientId !== clientId) return res.status(403).json({ message: "Only the gig client can lock funds." });
        if (gig.status !== "IN_PROGRESS") return res.status(400).json({ message: "Funds can only be locked for an active gig." });

        const userClient = Client.forTestnet().setOperator(clientId, clientPrivateKey);

        const transaction = new ContractExecuteTransaction()
            .setContractId(gig.escrowContractId)
            .setGas(150000)
            .setFunction("lockFunds")
            .setPayableAmount(new Hbar(amount));

        const txResponse = await transaction.execute(userClient);
        await txResponse.getReceipt(userClient);

        res.status(200).json({ message: `Successfully locked ${amount} HBAR for gig ${gigRefId}.` });
    } catch (error) {
        res.status(500).json({ message: "Error locking funds", error: error.toString() });
    }
});

app.post("/gigs/:gigRefId/release-escrow", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { clientId, clientPrivateKey } = req.body;
        if (!clientId || !clientPrivateKey) return res.status(400).json({ message: "Missing required fields." });

        const gig = gigsDB[gigRefId];
        if (!gig || !gig.escrowContractId) return res.status(404).json({ message: "Gig not found or no escrow associated." });
        if (gig.clientId !== clientId) return res.status(403).json({ message: "Only the gig client can release funds." });

        const userClient = Client.forTestnet().setOperator(clientId, clientPrivateKey);

        const transaction = new ContractExecuteTransaction()
            .setContractId(gig.escrowContractId)
            .setGas(150000)
            .setFunction("releaseFunds");

        const txResponse = await transaction.execute(userClient);
        await txResponse.getReceipt(userClient);

        // Update gig status
        gigsDB[gigRefId].status = "COMPLETED";
        saveDB(GIGS_DB_FILE, gigsDB);

        // --- **NEW** AWARD XP ---
        const freelancerId = gig.assignedFreelancerId;
        if (freelancerId) {
            const xpToAward = 100; // Can be dynamic based on gig budget later
            xpDB[freelancerId] = (xpDB[freelancerId] || 0) + xpToAward;
            saveDB(XP_DB_FILE, xpDB);
            console.log(`Awarded ${xpToAward} XP to freelancer ${freelancerId}. New total: ${xpDB[freelancerId]}`);
        }

        res.status(200).json({ message: `Successfully released funds for gig ${gigRefId}.` });
    } catch (error) {
        res.status(500).json({ message: "Error releasing funds", error: error.toString() });
    }
});


// --- 5. GIG MESSAGING (NEW) ---
app.post("/gigs/:gigRefId/messages", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { senderId, senderPrivateKey, content } = req.body;

        if (!senderId || !senderPrivateKey || !content) return res.status(400).json({ message: "Sender ID, private key, and content are required." });
        if (!gigsDB[gigRefId]) return res.status(404).json({ message: "Gig not found." });

        const gig = gigsDB[gigRefId];
        if (gig.clientId !== senderId && gig.assignedFreelancerId !== senderId) {
            return res.status(403).json({ message: "Only the client or assigned freelancer can send messages for this gig." });
        }

        const messageData = {
            type: "GIG_MESSAGE",
            gigRefId,
            senderId,
            content,
            timestamp: new Date().toISOString()
        };

        const transaction = new TopicMessageSubmitTransaction({ topicId: messagesTopicId, message: JSON.stringify(messageData) });

        const userClient = Client.forTestnet().setOperator(senderId, senderPrivateKey);
        const signedTx = await transaction.freezeWith(userClient).sign(PrivateKey.fromStringECDSA(senderPrivateKey));
        const txResponse = await signedTx.execute(userClient);
        const receipt = await txResponse.getReceipt(userClient);

        // Store message in persistent DB for faster retrieval <--- **CHANGE**
        if (!messagesDB[gigRefId]) messagesDB[gigRefId] = [];
        messagesDB[gigRefId].push(messageData);
        saveDB(MESSAGES_DB_FILE, messagesDB); // <-- **PERSISTENCE SAVE**

        res.status(201).json({ message: "Message sent successfully.", receipt });
    } catch (error) {
        res.status(500).json({ message: "Error sending message", error: error.toString() });
    }
});

app.get("/gigs/:gigRefId/messages", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        if (!gigsDB[gigRefId]) return res.status(404).json({ message: "Gig not found." });

        // Retrieve from persistent DB first (faster and includes all messages sent via this backend instance)
        if (messagesDB[gigRefId]) {
            return res.status(200).json(messagesDB[gigRefId]);
        }

        // Fallback to Mirror Node for historical messages not in cache
        const mirrorNodeUrl = `${MIRROR_NODE_URL}/topics/${messagesTopicId}/messages?limit=100`; // Fetch recent messages
        const response = await axios.get(mirrorNodeUrl);
        const messages = response.data.messages;

        const gigMessages = [];
        for (const msg of messages) {
            const messageString = Buffer.from(msg.message, "base64").toString("utf-8");
            try {
                const messageJson = JSON.parse(messageString);
                if (messageJson.type === "GIG_MESSAGE" && messageJson.gigRefId === gigRefId) {
                    gigMessages.push(messageJson);
                }
            } catch (e) { /* ignore parse errors */ }
        }

        // Cache these fetched messages into persistent DB <--- **CHANGE**
        messagesDB[gigRefId] = gigMessages;
        saveDB(MESSAGES_DB_FILE, messagesDB); // <-- **PERSISTENCE SAVE**

        res.status(200).json(gigMessages);
    } catch (error) {
        res.status(500).json({ message: "Error fetching messages", error: error.toString() });
    }
});

app.post("/claim-reward", async (req, res) => {
    try {
        const { accountId, privateKey, rewardId } = req.body;
        if (!accountId || !privateKey || !rewardId) {
            return res.status(400).json({ message: "accountId, privateKey, and rewardId are required." });
        }

        const tier = rewardTiers[rewardId];
        if (!tier) return res.status(404).json({ message: "Reward tier not found." });

        // 1. Check Eligibility
        const userXP = xpDB[accountId] || 0;
        if (userXP < tier.xpRequired) {
            return res.status(403).json({ message: `Not enough XP. Requires ${tier.xpRequired}, you have ${userXP}.` });
        }

        // Check if already claimed
        if (rewardsDB[accountId] && rewardsDB[accountId].includes(rewardId)) {
            return res.status(400).json({ message: "You have already claimed this reward." });
        }

        // 2. Associate Token (Requires freelancer's signature)
        const userClient = Client.forTestnet().setOperator(accountId, privateKey);
        const associateTx = await new TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([tier.tokenId])
            .freezeWith(userClient);

        const signedAssociateTx = await associateTx.sign(PrivateKey.fromStringECDSA(privateKey));
        await (await signedAssociateTx.execute(userClient)).getReceipt(userClient);
        console.log(`- User ${accountId} associated with Token ID ${tier.tokenId}`);

        // 3. Mint the NFT (Platform pays and signs)
        const mintTx = new TokenMintTransaction()
            .setTokenId(tier.tokenId)
            .setMetadata([Buffer.from(`ipfs://bafybeih255ap4a7bhh67pr4om62rlphxcfe6iataycs62fg5vcyv5ambb4/${rewardId}`)]) // Example IPFS CID
            .freezeWith(platformClient);

        const signedMintTx = await mintTx.sign(PrivateKey.fromStringECDSA(myPrivateKey));
        const mintResponse = await signedMintTx.execute(platformClient);
        const mintReceipt = await mintResponse.getReceipt(platformClient);
        const serialNumber = mintReceipt.serials[0].low; // Get the serial number of the new NFT
        console.log(`- Minted NFT for ${tier.name} with serial number ${serialNumber}`);

        // 4. Transfer NFT to Freelancer (Platform pays and signs)
        const transferTx = await new TransferTransaction()
            .addNftTransfer(tier.tokenId, serialNumber, myAccountId, accountId)
            .freezeWith(platformClient)
            .sign(PrivateKey.fromStringECDSA(myPrivateKey));

        await (await transferTx.execute(platformClient)).getReceipt(platformClient);
        console.log(`- Transferred NFT ${tier.tokenId}#${serialNumber} to ${accountId}`);

        // 5. Update local records
        if (!rewardsDB[accountId]) rewardsDB[accountId] = [];
        rewardsDB[accountId].push(rewardId);
        saveDB(REWARDS_DB_FILE, rewardsDB);

        res.status(200).json({
            message: `Successfully claimed ${tier.name}!`,
            tokenId: tier.tokenId,
            serialNumber,
        });

    } catch (error) {
        console.error("Error claiming reward:", error);
        res.status(500).json({ message: "Error claiming reward", error: error.toString() });
    }
});


// --- 6. ARBITER ENDPOINTS (Unchanged) ---
// ... (Arbiter endpoints remain the same as they don't modify the local DBs)
app.post("/arbiter/release", async (req, res) => {
    try {
        const { contractId } = req.body;
        if (!contractId) {
            return res.status(400).json({ message: "Contract ID is required." });
        }

        console.log(`Arbiter is force-releasing funds for contract: ${contractId}`);

        // The ARBITER (our treasury account) is the one signing this transaction
        const releaseTx = await new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(150000)
            .setFunction("releaseFunds")
            .execute(platformClient); // Use the main client, which is set to our treasury/arbiter account

        await releaseTx.getReceipt(platformClient);

        res.status(200).json({ message: `Arbiter successfully released funds from contract ${contractId}.` });

    } catch (error) {
        console.error("Arbiter error releasing funds:", error);
        res.status(500).json({ message: "Arbiter error releasing funds", error: error.toString() });
    }
});


// --- ARBITER ENDPOINT TO FORCE-CANCEL ESCROW ---
app.post("/arbiter/cancel", async (req, res) => {
    try {
        const { contractId } = req.body;
        if (!contractId) {
            return res.status(400).json({ message: "Contract ID is required." });
        }

        console.log(`Arbiter is force-cancelling escrow for contract: ${contractId}`);

        // The ARBITER (our treasury account) is the one signing this transaction
        const cancelTx = await new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(150000)
            .setFunction("cancelEscrow")
            .execute(platformClient); // Use the main client, which is set to our treasury/arbiter account

        await cancelTx.getReceipt(platformClient);

        res.status(200).json({ message: `Arbiter successfully cancelled escrow for contract ${contractId}.` });

    } catch (error) {
        console.error("Arbiter error cancelling escrow:", error);
        res.status(500).json({ message: "Arbiter error cancelling escrow", error: error.toString() });
    }
});