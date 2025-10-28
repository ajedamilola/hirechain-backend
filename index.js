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

// Main client for platform-paid transactions
const platformClient = Client.forTestnet();
platformClient.setOperator(AccountId.fromString(myAccountId), PrivateKey.fromStringECDSA(myPrivateKey));

// Compile the escrow smart contract
const contractSource = fs.readFileSync(path.join(".", "Escrow.sol"), "utf8");
const input = { language: "Solidity", sources: { "Escrow.sol": { content: contractSource } }, settings: { outputSelection: { "*": { "*": ["*"] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const bytecode = output.contracts["Escrow.sol"]["HireChainEscrow"].evm.bytecode.object;

// --- JSON File Constants ---
const PROFILE_DB_FILE = "profiles.json";
const GIGS_DB_FILE = "gigs.json";
const MESSAGES_DB_FILE = "messages.json";
const XP_DB_FILE = "xp.json";
const REWARDS_DB_FILE = "rewards.json";

// --- Database Initialization ---
let gigsDB = {}, profilesDB = {}, messagesDB = {}, xpDB = {}, rewardsDB = {};

// --- Helper Functions (loadDB, saveDB, HCS Sync, NFT Init) ---
// =================================================================
// --- HELPER FUNCTIONS ---
// =================================================================

/**
 * Loads data from a JSON file. Returns an empty object if the file doesn't exist or is invalid.
 * @param {string} filename The name of the JSON file.
 * @returns {object} The parsed JavaScript object.
 */
const loadDB = (filename) => {
    try {
        if (fs.existsSync(filename)) {
            const data = fs.readFileSync(filename, "utf8");
            // Handle empty file case
            return JSON.parse(data || "{}");
        }
    } catch (error) {
        console.error(`Error loading ${filename}:`, error);
    }
    // Return empty object if file doesn't exist or is corrupt
    return {};
};

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
 * Saves a JavaScript object to a JSON file with pretty formatting.
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
 * Orchestrates the synchronization of local JSON databases with the latest state from HCS.
 */
const syncFromMirrorNode = async () => {
    console.log("--- Starting HCS Synchronization ---");

    // 1. Gigs Synchronization (Handles both creation and updates)
    const newGigsDB = {};
    const gigsProcessor = (message) => {
        if (message.type === "GIG_CREATE") {
            newGigsDB[message.gigRefId] = { ...message, status: "OPEN", escrowContractId: null, assignedFreelancerId: null };
        } else if (message.type === "GIG_UPDATE" && newGigsDB[message.gigRefId]) {
            // Apply updates to the existing gig state
            newGigsDB[message.gigRefId] = { ...newGigsDB[message.gigRefId], ...message };
        }
    };
    const gigsCount = await fetchAndProcessTopicMessages(gigsTopicId, gigsProcessor);
    gigsDB = newGigsDB;
    saveDB(GIGS_DB_FILE, gigsDB);
    console.log(`[GIGS] Synced ${gigsCount} HCS messages. ${Object.keys(gigsDB).length} unique gigs loaded.`);

    // 2. Profiles Synchronization
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

    // 3. Messages Synchronization
    const newMessagesDB = {};
    const messagesProcessor = (message) => {
        if (message.type === "GIG_MESSAGE" && message.gigRefId) {
            if (!newMessagesDB[message.gigRefId]) newMessagesDB[message.gigRefId] = [];
            newMessagesDB[message.gigRefId].push(message);
        }
    };
    const messagesCount = await fetchAndProcessTopicMessages(messagesTopicId, messagesProcessor);
    messagesDB = newMessagesDB;
    saveDB(MESSAGES_DB_FILE, messagesDB);
    console.log(`[MESSAGES] Synced ${messagesCount} HCS messages across ${Object.keys(messagesDB).length} gigs.`);

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
    await syncFromMirrorNode();
    xpDB = loadDB(XP_DB_FILE);
    rewardsDB = loadDB(REWARDS_DB_FILE);
    console.log(`Loaded ${Object.keys(xpDB || {}).length} XP records and ${Object.keys(rewardsDB || {}).length} reward records.`);
    await initializeNftCollections();
    if (!process.env.NODE_ENV != "VERCEL") {
        const port = process.env.PORT || 3000;
        app.listen(port, () => console.log(`HireChain backend listening on port ${port}`));
    }
};
startServer();


// =================================================================
// --- 2. USER MANAGEMENT (PREPARE / RECORD) ---
// =================================================================

// NOTE: Account creation is a special case. The platform pays for it, so it happens here.
// The frontend will then use the returned keys to sign the profile creation.
app.post("/users/create-account", async (req, res) => {
    try {
        const newAccountPrivateKey = PrivateKey.generateED25519();
        const newAccountPublicKey = newAccountPrivateKey.publicKey;
        const newAccountTx = await new AccountCreateTransaction()
            .setKey(newAccountPublicKey)
            .setInitialBalance(new Hbar(10)) // Generous starting balance
            .execute(platformClient);

        const receipt = await newAccountTx.getReceipt(platformClient);
        const newAccountId = receipt.accountId;

        res.status(201).json({
            message: "Account created! Securely store the private key.",
            accountId: newAccountId.toString(),
            privateKey: newAccountPrivateKey.toStringRaw(), // Send to user ONCE to store
        });
    } catch (error) {
        res.status(500).json({ message: "Account creation failed", error: error.toString() });
    }
});

app.post("/users/prepare-profile-creation", async (req, res) => {
    try {
        const { accountId, name, skills, portfolioUrl, email } = req.body;
        if (!accountId || !name || !skills || !email) {
            return res.status(400).json({ message: "All profile fields are required." });
        }

        const profileData = { type: "PROFILE_CREATE", userAccountId: accountId, name, skills, portfolioUrl, email };
        const transaction = new TopicMessageSubmitTransaction({
            topicId: profileTopicId,
            message: JSON.stringify(profileData),
            transactionId: TransactionId.generate(accountId)
        }).setTransactionId(TransactionId.generate(accountId))
            .freezeWith(Client.forTestnet());

        const encodedTransaction = Buffer.from(transaction.toBytes()).toString("base64");
        res.status(200).json({ encodedTransaction, profileData });
    } catch (error) {
        res.status(500).json({ message: "Error preparing profile transaction", error: error.toString() });
    }
});

app.post("/users/record-profile-creation", async (req, res) => {
    try {
        const { profileData } = req.body;
        if (!profileData || !profileData.userAccountId) {
            return res.status(400).json({ message: "Profile data is required." });
        }
        profilesDB[profileData.userAccountId] = profileData;
        saveDB(PROFILE_DB_FILE, profilesDB);
        res.status(201).json({ message: "Profile successfully recorded." });
    } catch (error) {
        res.status(500).json({ message: "Error recording profile", error: error.toString() });
    }
});


// =================================================================
// --- 3. GIG MANAGEMENT (PREPARE / RECORD) ---
// =================================================================

app.post("/gigs/prepare-creation", async (req, res) => {
    try {
        const { clientId, title, description, budget, duration } = req.body;
        if (!clientId || !title || !description || !budget) {
            return res.status(400).json({ message: "Missing required gig fields." });
        }

        const gigRefId = uuidv4();
        const gigData = { type: "GIG_CREATE", gigRefId, clientId, title, description, duration, budget: `${budget} HBAR`, status: "OPEN" };

        const transaction = new TopicMessageSubmitTransaction({
            topicId: gigsTopicId,
            message: JSON.stringify(gigData),
            transactionId: TransactionId.generate(clientId)
        }).setTransactionId(TransactionId.generate(clientId)).freezeWith(Client.forTestnet());

        const encodedTransaction = Buffer.from(transaction.toBytes()).toString("base64");
        res.status(200).json({ encodedTransaction, gigData });
    } catch (error) {
        res.status(500).json({ message: "Error preparing gig creation", error: error.toString() });
    }
});

app.post("/gigs/record-creation", (req, res) => {
    try {
        const { gigData, hcsSequenceNumber } = req.body;
        gigsDB[gigData.gigRefId] = { ...gigData, hcsSequenceNumber, escrowContractId: null, assignedFreelancerId: null };
        saveDB(GIGS_DB_FILE, gigsDB);
        res.status(201).json({ message: "Gig creation recorded.", gigRefId: gigData.gigRefId });
    } catch (error) {
        res.status(500).json({ message: "Error recording gig", error: error.toString() });
    }
});

app.post("/gigs/:gigRefId/prepare-assignment", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { clientId, freelancerAccountId } = req.body;

        // --- Validation ---
        if (!gigsDB[gigRefId] || gigsDB[gigRefId].clientId !== clientId || gigsDB[gigRefId].status !== "OPEN") {
            return res.status(403).json({ message: "Invalid request or gig is not open." });
        }

        // =============================================================
        // --- 1. UPLOAD BYTECODE IN CHUNKS (NEW LOGIC) ---
        // =============================================================

        // Define a chunk size safely under the 6KB limit to account for transaction overhead
        const CHUNK_SIZE = 4096;
        let fileId; // This will hold the final file ID

        // The private key to sign for file operations. Using the platform's key is standard.
        const fileKey = PrivateKey.fromStringECDSA(myPrivateKey);

        // A) Create the file with the FIRST chunk of bytecode
        const fileCreateTx = new FileCreateTransaction()
            .setKeys([fileKey.publicKey])
            .setContents(bytecode.substring(0, CHUNK_SIZE))
            .freezeWith(platformClient);

        const signedCreateTx = await fileCreateTx.sign(fileKey);
        const createTxResponse = await signedCreateTx.execute(platformClient);
        const createReceipt = await createTxResponse.getReceipt(platformClient);
        fileId = createReceipt.fileId;

        console.log(`- Created temporary bytecode file with ID: ${fileId}`);

        // B) Append the rest of the bytecode in a loop if necessary
        if (bytecode.length > CHUNK_SIZE) {
            for (let i = CHUNK_SIZE; i < bytecode.length; i += CHUNK_SIZE) {
                const chunk = bytecode.substring(i, i + CHUNK_SIZE);

                const fileAppendTx = new FileAppendTransaction()
                    .setFileId(fileId)
                    .setContents(chunk)
                    .freezeWith(platformClient);

                const signedAppendTx = await fileAppendTx.sign(fileKey);
                // Execute and wait for the receipt to ensure it's confirmed before the next chunk
                await (await signedAppendTx.execute(platformClient)).getReceipt(platformClient);

                console.log(`- Appended chunk starting at byte ${i}`);
            }
        }
        console.log("- Bytecode upload complete.");


        // =============================================================
        // --- 2. PREPARE TRANSACTIONS FOR FRONTEND ---
        // =============================================================

        // A) Prepare the Contract Creation transaction, referencing the new fileId
        const contractCreateTx = new ContractCreateTransaction()
            .setBytecodeFileId(fileId) // Use the ID of the file we just uploaded
            .setGas(10_000_000)
            .setTransactionId(TransactionId.generate(clientId)) // The client will pay for this
            .freezeWith(Client.forTestnet()); // Freeze without a client, as the frontend will provide the signature

        // B) Prepare the HCS Update transaction
        const updateGigData = { type: "GIG_UPDATE", gigRefId, clientId, status: "IN_PROGRESS", assignedFreelancerId: freelancerAccountId, timestamp: new Date().toISOString() };
        const updateHcsTx = new TopicMessageSubmitTransaction({
            topicId: gigsTopicId,
            message: JSON.stringify(updateGigData),
            transactionId: TransactionId.generate(clientId) // Client also pays for this
        }).setTransactionId(TransactionId.generate(clientId)).freezeWith(Client.forTestnet());

        // C) Encode both transactions to Base64 to send to the frontend
        const encodedContractTx = Buffer.from(contractCreateTx.toBytes()).toString("base64");
        const encodedHcsTx = Buffer.from(updateHcsTx.toBytes()).toString("base64");

        res.status(200).json({ encodedContractTx, encodedHcsTx, freelancerAccountId, updateGigData });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error preparing assignment", error: error.toString() });
    }
});

app.post("/gigs/:gigRefId/record-assignment", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { contractTransactionId, freelancerAccountId, updateGigData } = req.body;

        if (!contractTransactionId || !freelancerAccountId || !updateGigData) {
            return res.status(400).json({ message: "contractTransactionId, freelancerAccountId, and updateGigData are required." });
        }

        // 1. Use the transactionId to get the newContractId from the Mirror Node
        const newContractId = await getEntityIdFromTransaction(contractTransactionId);

        // 2. Now that we have the contractId, update our database
        gigsDB[gigRefId].status = "IN_PROGRESS";
        gigsDB[gigRefId].assignedFreelancerId = freelancerAccountId;
        gigsDB[gigRefId].escrowContractId = newContractId.toString(); // Use the ID we just fetched
        gigsDB[gigRefId] = { ...gigsDB[gigRefId], ...updateGigData };
        saveDB(GIGS_DB_FILE, gigsDB);

        // 3. Send email notification
        const freelancer = profilesDB[freelancerAccountId];
        const gig = gigsDB[gigRefId];
        if (freelancer) {
            await sendEmail({
                to: freelancer.email,
                subject: "Assignment Recorded",
                template: "gig_notifier.ejs",
                data: {
                    name: freelancer.name,
                    gigTitle: gig.title,
                    gigRefId: gigRefId,
                    budget: gig.budget,
                    duration: gig.duration,
                    description: gig.description,
                    actionUrl: `https://frontendurl/gigs/${gigRefId}`,
                }
            });
        }
        res.status(200).json({
            message: "Assignment recorded successfully.",
            newContractId: newContractId.toString() // Send the new ID back to the frontend for confirmation
        });

    } catch (error) {
        console.error("Error in /record-assignment:", error);
        res.status(500).json({ message: "Failed to record assignment", error: error.toString() });
    }
});

// =================================================================
// --- 4. ESCROW MANAGEMENT (PREPARE / RECORD) ---
// =================================================================

app.post("/gigs/:gigRefId/prepare-lock-escrow", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { clientId, amount } = req.body;
        const gig = gigsDB[gigRefId];

        console.log({ gig })
        const transaction = new ContractExecuteTransaction()
            .setContractId(ContractId.fromString(gig.escrowContractId))
            .setGas(1_050_000)
            .setFunction("lockFunds")
            .setPayableAmount(new Hbar(amount))
            .setTransactionId(TransactionId.generate(clientId))
            .freezeWith(Client.forTestnet());

        const encodedTransaction = Buffer.from(transaction.toBytes()).toString("base64");
        res.status(200).json({ encodedTransaction });
    } catch (error) {
        console.log(error)
        res.status(500).json({ message: "Error preparing lock transaction", error: error.toString() });
    }
});

app.post("/gigs/:gigRefId/record-lock-escrow", (req, res) => {
    // No DB state change needed from our side, but we provide the endpoint for flow consistency.
    //TODO: Actually Do State the escrow state in the DB
    console.log(`Lock recorded for gig ${req.params.gigRefId}`);
    res.status(200).json({ message: "Lock-in successfully recorded." });
});

app.post("/gigs/:gigRefId/prepare-release-escrow", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const { clientId } = req.body;
        const gig = gigsDB[gigRefId];

        const transaction = new ContractExecuteTransaction()
            .setContractId(ContractId.fromString(gig.escrowContractId))
            .setGas(1_050_000)
            .setFunction("releaseFunds")
            .setTransactionId(TransactionId.generate(clientId))
            .freezeWith(Client.forTestnet());

        const encodedTransaction = Buffer.from(transaction.toBytes()).toString("base64");
        res.status(200).json({ encodedTransaction });
    } catch (error) {
        res.status(500).json({ message: "Error preparing release transaction", error: error.toString() });
    }
});

app.post("/gigs/:gigRefId/record-release-escrow", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        const gig = gigsDB[gigRefId];

        gigsDB[gigRefId].status = "COMPLETED";
        saveDB(GIGS_DB_FILE, gigsDB);

        const freelancerId = gig.assignedFreelancerId;
        if (freelancerId) {
            const xpToAward = 100;
            xpDB[freelancerId] = (xpDB[freelancerId] || 0) + xpToAward;
            saveDB(XP_DB_FILE, xpDB);
            console.log(`Awarded ${xpToAward} XP to freelancer ${freelancerId}.`);
            await sendEmail({ to: profilesDB[freelancerId].email, /* ... email details ... */ });
        }
        res.status(200).json({ message: "Escrow release recorded." });
    } catch (error) {
        res.status(500).json({ message: "Error recording release", error: error.toString() });
    }
});

// =================================================================
// --- 5. REWARDS SYSTEM (PREPARE / RECORD) ---
// =================================================================

app.post("/rewards/prepare-association", async (req, res) => {
    try {
        const { accountId, rewardId } = req.body;
        // Validation...
        const tier = rewardTiers[rewardId];
        if (!tier || (xpDB[accountId] || 0) < tier.xpRequired || (rewardsDB[accountId] || []).includes(rewardId)) {
            return res.status(403).json({ message: "Not eligible for this reward." });
        }

        const transaction = new TokenAssociateTransaction()
            .setAccountId(accountId)
            .setTokenIds([tier.tokenId])
            .setTransactionId(TransactionId.generate(accountId))
            .freeze();

        const encodedTransaction = Buffer.from(transaction.toBytes()).toString("base64");
        res.status(200).json({ encodedTransaction });
    } catch (error) {
        res.status(500).json({ message: "Error preparing association", error: error.toString() });
    }
});

// This is a platform-paid action, so it's a direct execution, not prepare/record.
// The frontend calls this AFTER the association transaction is successful.
app.post("/rewards/mint-and-transfer", async (req, res) => {
    try {
        const { accountId, rewardId } = req.body;
        const tier = rewardTiers[rewardId];

        // Mint the NFT
        const mintTx = await new TokenMintTransaction()
            .setTokenId(tier.tokenId)
            .setMetadata([Buffer.from(`ipfs://.../${rewardId}`)])
            .execute(platformClient);
        const mintReceipt = await mintTx.getReceipt(platformClient);
        const serialNumber = mintReceipt.serials[0].low;

        // Transfer the NFT
        const transferTx = await new TransferTransaction()
            .addNftTransfer(tier.tokenId, serialNumber, myAccountId, accountId)
            .execute(platformClient);
        await transferTx.getReceipt(platformClient);

        // Record the reward
        if (!rewardsDB[accountId]) rewardsDB[accountId] = [];
        rewardsDB[accountId].push(rewardId);
        saveDB(REWARDS_DB_FILE, rewardsDB);

        res.status(200).json({ message: "Reward NFT minted and transferred!", tokenId: tier.tokenId, serialNumber });
    } catch (error) {
        res.status(500).json({ message: "Error minting reward", error: error.toString() });
    }
});

// =================================================================
// --- 6. READ-ONLY AND ARBITER ENDPOINTS (Unchanged) ---
// =================================================================

// --- READ-ONLY ENDPOINTS ---

// Endpoint to list all *open* gigs for the marketplace view
app.get("/gigs", async (req, res) => {
    try {
        // Only return gigs with the status "OPEN"
        const openGigs = Object.values(gigsDB).filter(gig => gig.status === "OPEN");
        res.status(200).json(openGigs);
    } catch (error) {
        res.status(500).json({ message: "Error listing open gigs", error: error.toString() });
    }
});

// Endpoint to fetch all gigs a specific user is involved in (for their dashboard)
app.get("/users/:accountId/gigs", async (req, res) => {
    try {
        const { accountId } = req.params;
        if (!accountId) {
            return res.status(400).json({ message: "Account ID is required to fetch user gigs." });
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

// Get a single gig by its unique reference ID
app.get("/gigs/:gigRefId", async (req, res) => {
    const { gigRefId } = req.params;
    if (gigsDB[gigRefId]) {
        return res.status(200).json(gigsDB[gigRefId]);
    }
    // Optional: Could fall back to mirror node search here in a real app
    res.status(404).json({ message: "Gig not found." });
});

// Get a user's profile by their account ID
app.get("/users/profile/:accountId", async (req, res) => {
    const { accountId } = req.params;
    if (profilesDB[accountId]) {
        return res.status(200).json(profilesDB[accountId]);
    }
    // In this architecture, profiles are synced at startup. If not found, it doesn't exist on-chain either.
    res.status(404).json({ message: "Profile not found for this account." });
});

// Get the message history for a specific gig
app.get("/gigs/:gigRefId/messages", async (req, res) => {
    const { gigRefId } = req.params;
    if (!gigsDB[gigRefId]) {
        return res.status(404).json({ message: "Gig not found." });
    }
    // Return messages from our local DB, which was synced at startup
    const gigMessages = messagesDB[gigRefId] || [];
    res.status(200).json(gigMessages);
});


// --- ARBITER ENDPOINTS ---
// These are platform-paid, direct-execution endpoints for administrative dispute resolution.

app.post("/arbiter/release", async (req, res) => {
    try {
        const { contractId } = req.body;
        if (!contractId) {
            return res.status(400).json({ message: "Contract ID is required." });
        }
        console.log(`Arbiter is force-releasing funds for contract: ${contractId}`);
        // The ARBITER (our treasury account) signs this transaction directly.
        const releaseTx = await new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(150000)
            .setFunction("releaseFunds")
            .execute(platformClient); // Use the main client, which is our treasury/arbiter account

        await releaseTx.getReceipt(platformClient);
        // Optional: Update the corresponding gig's status to "COMPLETED_BY_ARBITER" in gigsDB
        res.status(200).json({ message: `Arbiter successfully released funds from contract ${contractId}.` });
    } catch (error) {
        console.error("Arbiter error releasing funds:", error);
        res.status(500).json({ message: "Arbiter error releasing funds", error: error.toString() });
    }
});

app.post("/arbiter/cancel", async (req, res) => {
    try {
        const { contractId } = req.body;
        if (!contractId) {
            return res.status(400).json({ message: "Contract ID is required." });
        }
        console.log(`Arbiter is force-cancelling escrow for contract: ${contractId}`);
        // The ARBITER (our treasury account) signs this transaction directly.
        const cancelTx = await new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(150000)
            .setFunction("cancelEscrow")
            .execute(platformClient); // Use the main client, which is our treasury/arbiter account

        await cancelTx.getReceipt(platformClient);
        // Optional: Update the corresponding gig's status to "CANCELLED_BY_ARBITER" in gigsDB
        res.status(200).json({ message: `Arbiter successfully cancelled escrow for contract ${contractId}.` });
    } catch (error) {
        console.error("Arbiter error cancelling escrow:", error);
        res.status(500).json({ message: "Arbiter error cancelling escrow", error: error.toString() });
    }
});