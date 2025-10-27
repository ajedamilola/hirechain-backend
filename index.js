import {
    Client,
    PrivateKey,
    AccountCreateTransaction,
    Hbar,
    AccountId,
    TopicMessageSubmitTransaction,
    TopicId,
    ContractCreateTransaction,
    ContractExecuteTransaction,
    ContractFunctionParameters,
    ContractCreateFlow
} from "@hashgraph/sdk";
import express from "express";
import * as dotenv from "dotenv";
import axios from "axios";
import { v4 as uuidv4 } from 'uuid'; // For generating unique gig IDs
import fs from "fs";
import solc from "solc";

// --- 1. INITIAL SETUP & CONFIGURATION ---
dotenv.config();
const app = express();
app.use(express.json());

const myAccountId = process.env.TREASURY_ACCOUNT_ID;
const myPrivateKey = process.env.TREASURY_PRIVATE_KEY;
const profileTopicId = process.env.HIRECHAIN_PROFILE_TOPIC_ID;
const gigsTopicId = process.env.HIRECHAIN_GIGS_TOPIC_ID;
const messagesTopicId = process.env.HIRECHAIN_MESSAGES_TOPIC_ID; // NEW: Messages Topic ID

if (!myAccountId || !myPrivateKey || !profileTopicId || !gigsTopicId || !messagesTopicId) {
    throw new Error("All required environment variables must be present");
}

// Main client for platform-paid transactions (like creating accounts)
const platformClient = Client.forTestnet();
platformClient.setOperator(AccountId.fromString(myAccountId), PrivateKey.fromStringECDSAECDSA(myPrivateKey));

// Compile the escrow smart contract
const contractSource = fs.readFileSync("Escrow.sol", "utf8");
const input = { language: "Solidity", sources: { "Escrow.sol": { content: contractSource } }, settings: { outputSelection: { "*": { "*": ["*"] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const bytecode = output.contracts["Escrow.sol"]["HireChainEscrow"].evm.bytecode.object;

// --- In-Memory "Database" (for demonstration purposes only) ---
// In a real application, this would be a persistent database (PostgreSQL, MongoDB etc.)
const gigsDB = {};     // Stores gigRefId -> { gigData, hcsSequenceNumber, escrowContractId?, assignedFreelancerId? }
const profilesDB = {};  // Stores accountId -> { profileData } (for quick lookups)
const messagesDB = {};  // Stores gigRefId -> [message objects]

// --- Helper for fetching from Mirror Node ---
const MIRROR_NODE_URL = `https://testnet.mirrornode.hedera.com/api/v1`;


// --- 2. USER MANAGEMENT ---
app.post("/register", async (req, res) => {
    try {
        const { name, skills, portfolioUrl } = req.body;
        if (!name || !skills) return res.status(400).json({ message: "Name and skills are required." });

        // Step 1: Create the Hedera Account (paid by the platform)
        const newAccountPrivateKey = PrivateKey.generateED25519();
        const newAccountPublicKey = newAccountPrivateKey.publicKey;
        const newAccountTx = await new AccountCreateTransaction().setKey(newAccountPublicKey).setInitialBalance(new Hbar(10)).execute(platformClient);
        const receipt = await newAccountTx.getReceipt(platformClient);
        const newAccountId = receipt.accountId;

        // Step 2: Create the On-Chain Profile (paid by the new user's account)
        const profileData = { type: "PROFILE_CREATE", userAccountId: newAccountId.toString(), name, skills, portfolioUrl };
        const profileTx = new TopicMessageSubmitTransaction({ topicId: profileTopicId, message: JSON.stringify(profileData) });

        const userClient = Client.forTestnet();
        userClient.setOperator(newAccountId, newAccountPrivateKey);
        const signedProfileTx = await profileTx.sign(newAccountPrivateKey);
        await signedProfileTx.execute(userClient);

        // Store profile in in-memory DB for quick access
        profilesDB[newAccountId.toString()] = profileData;

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

// Get user profile (NEW)
app.get("/users/profile/:accountId", async (req, res) => {
    try {
        const accountId = req.params.accountId;
        // Check in-memory DB first (faster)
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
                    profilesDB[accountId] = userProfile; // Cache it
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
        const signedTx = await transaction.sign(PrivateKey.fromStringECDSA(clientPrivateKey));
        const txResponse = await signedTx.execute(userClient);
        const receipt = await txResponse.getReceipt(userClient);

        // Store gig in our in-memory DB (keyed by gigRefId)
        gigsDB[gigRefId] = {
            ...gigData,
            hcsSequenceNumber: receipt.topicSequenceNumber.toString(),
            escrowContractId: null, // Initially no escrow
            assignedFreelancerId: null, // Initially no freelancer
        };

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
            .setGas(100000); // Only deploys the contract logic

        const createResponse = await contractCreateTx.execute(userClient);
        const createReceipt = await createResponse.getReceipt(userClient);
        const newContractId = createReceipt.contractId;

        // Call initEscrow to set client and freelancer
        const initEscrowTx = new ContractExecuteTransaction()
            .setContractId(newContractId)
            .setGas(100000)
            .setFunction("initEscrow", new ContractFunctionParameters().addAddress(AccountId.fromString(freelancerAccountId).toEvmAddress()));

        await initEscrowTx.execute(userClient).getReceipt(userClient);

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
        await updateGigTx.execute(userClient).getReceipt(userClient);

        // 3. Update in-memory DB
        gigsDB[gigRefId].status = "IN_PROGRESS";
        gigsDB[gigRefId].assignedFreelancerId = freelancerAccountId;
        gigsDB[gigRefId].escrowContractId = newContractId.toString();

        res.status(200).json({
            message: "Freelancer assigned and escrow created successfully.",
            gigRefId,
            escrowContractId: newContractId.toString(),
        });

    } catch (error) {
        res.status(500).json({ message: "Error assigning freelancer/creating escrow", error: error.toString() });
    }
});

// Endpoint to list all gigs (retrieves from in-memory DB first, then mirror node for updates)
app.get("/gigs", async (req, res) => {
    try {
        const gigs = Object.values(gigsDB); // Get all gigs from our in-memory DB
        // In a real app, you'd also query the mirror node for the latest state of ALL gigs
        // and update your DB. For this example, we'll return what we have in memory.
        res.status(200).json(gigs);
    } catch (error) {
        res.status(500).json({ message: "Error listing gigs", error: error.toString() });
    }
});

// Get a single gig by gigRefId (NEW)
app.get("/gigs/:gigRefId", async (req, res) => {
    const { gigRefId } = req.params;
    if (gigsDB[gigRefId]) {
        return res.status(200).json(gigsDB[gigRefId]);
    }
    // In a real app, you'd try to fetch all messages for gigsTopicId and reconstruct the latest state for this gig.
    res.status(404).json({ message: "Gig not found." });
});


// --- 4. ESCROW MANAGEMENT (Now takes gigRefId, looks up contractId from DB) ---
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

        // Update gig status (optional, but good practice)
        gigsDB[gigRefId].status = "COMPLETED"; // Update in-memory DB
        // In a real app, you'd also send a GIG_UPDATE message to HCS here.

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
        const signedTx = await transaction.sign(PrivateKey.fromStringECDSA(senderPrivateKey));
        const txResponse = await signedTx.execute(userClient);
        const receipt = await txResponse.getReceipt(userClient);

        // Store message in in-memory DB for faster retrieval
        if (!messagesDB[gigRefId]) messagesDB[gigRefId] = [];
        messagesDB[gigRefId].push(messageData);

        res.status(201).json({ message: "Message sent successfully.", receipt });
    } catch (error) {
        res.status(500).json({ message: "Error sending message", error: error.toString() });
    }
});

app.get("/gigs/:gigRefId/messages", async (req, res) => {
    try {
        const { gigRefId } = req.params;
        if (!gigsDB[gigRefId]) return res.status(404).json({ message: "Gig not found." });

        // Retrieve from in-memory DB first (faster and includes all messages sent via this backend instance)
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
        // Optionally, cache these fetched messages into messagesDB[gigRefId]
        messagesDB[gigRefId] = gigMessages;

        res.status(200).json(gigMessages);
    } catch (error) {
        res.status(500).json({ message: "Error fetching messages", error: error.toString() });
    }
});


// --- 6. ARBITER ENDPOINTS (Unchanged) ---

// --- 5. ARBITER ENDPOINTS (Unchanged) ---

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
            .execute(client); // Use the main client, which is set to our treasury/arbiter account

        await releaseTx.getReceipt(client);

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
            .execute(client); // Use the main client, which is set to our treasury/arbiter account

        await cancelTx.getReceipt(client);

        res.status(200).json({ message: `Arbiter successfully cancelled escrow for contract ${contractId}.` });

    } catch (error) {
        console.error("Arbiter error cancelling escrow:", error);
        res.status(500).json({ message: "Arbiter error cancelling escrow", error: error.toString() });
    }
});



// --- 7. START THE SERVER ---
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`HireChain backend listening on port ${port}`);
});