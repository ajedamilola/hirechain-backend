import {
    Client,
    PrivateKey,
    AccountCreateTransaction,
    Hbar,
    AccountId,
    TopicMessageSubmitTransaction,
    TopicId,
    Transaction,
    ContractCreateTransaction,
    ContractExecuteTransaction,
    ContractFunctionParameters,
    TransactionId,
    ContractCreateFlow
} from "@hashgraph/sdk";
import express from "express";
import * as dotenv from "dotenv";
import axios from "axios";
import fs from "fs";
import solc from "solc";

// --- 1. INITIAL SETUP & CONFIGURATION ---
dotenv.config();
const app = express();
app.use(express.json());

// Load credentials and configuration from .env file
const myAccountId = process.env.TREASURY_ACCOUNT_ID;
const myPrivateKey = process.env.TREASURY_PRIVATE_KEY;
const profileTopicId = process.env.HIRECHAIN_PROFILE_TOPIC_ID;
const gigsTopicId = process.env.HIRECHAIN_GIGS_TOPIC_ID;

if (!myAccountId || !myPrivateKey || !profileTopicId || !gigsTopicId) {
    throw new Error("All environment variables must be present");
}

// Create a client for the backend to use for submitting transactions and paying for account creation
const client = Client.forTestnet();
client.setOperator(AccountId.fromString(myAccountId), PrivateKey.fromStringECDSA(myPrivateKey));

// Compile the escrow smart contract to have its bytecode ready
const contractSource = fs.readFileSync("Escrow.sol", "utf8");
const input = {
    language: "Solidity",
    sources: { "Escrow.sol": { content: contractSource } },
    settings: { outputSelection: { "*": { "*": ["*"] } } },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const bytecode = output.contracts["Escrow.sol"]["HireChainEscrow"].evm.bytecode.object;


// --- 2. THE GENERIC SUBMISSION ENDPOINT ---
// This is the cornerstone of the wallet-centric model. All signed transactions come here.
app.post("/transactions/submit", async (req, res) => {
    try {
        const { signedTxBase64 } = req.body;
        if (!signedTxBase64) {
            return res.status(400).json({ message: "Signed transaction is required." });
        }

        const signedTxBytes = Buffer.from(signedTxBase64, "base64");
        const signedTransaction = Transaction.fromBytes(signedTxBytes);

        const txResponse = await signedTransaction.execute(client);
        const receipt = await txResponse.getReceipt(client);

        res.status(200).json({
            message: "Transaction submitted successfully!",
            receipt: receipt
        });
    } catch (error) {
        console.error("Submission Error:", error);
        res.status(500).json({ message: "Error submitting transaction", error: error.toString() });
    }
});


// --- 3. USER ONBOARDING ---
// The platform pays to create the user's first account. This is the ONLY action
// that doesn't require a signature from the user's wallet.
app.post("/users/create-account", async (req, res) => {
    try {
        const newAccountPrivateKey = PrivateKey.generateECDSA();
        const newAccountPublicKey = newAccountPrivateKey.publicKey;

        const newAccountTx = await new AccountCreateTransaction()
            .setKeyWithoutAlias(newAccountPublicKey)
            .setInitialBalance(new Hbar(10)) // Sponsor user with 10 HBAR
            .execute(client);

        const receipt = await newAccountTx.getReceipt(client);
        const newAccountId = receipt.accountId;

        // In a real app, you would NOT send the private key. You'd instruct the user
        // to import it into their wallet. For this example, we return it.
        res.status(201).json({
            accountId: newAccountId.toString(),
            publicKey: newAccountPublicKey.toStringRaw(),
            privateKey: newAccountPrivateKey.toStringRaw(),
        });
    } catch (error) {
        res.status(500).json({ message: "Error creating account", error: error.toString() });
    }
});

// Endpoint to PREPARE a transaction for creating a user's on-chain profile
app.post("/users/prepare-profile-creation", async (req, res) => {
    try {
        const { userAccountId, name, skills, portfolioUrl } = req.body;

        const profileData = {
            type: "PROFILE_CREATE",
            userAccountId,
            name,
            skills,
            portfolioUrl,
            timestamp: new Date().toISOString()
        };

        const transaction = new TopicMessageSubmitTransaction({
            topicId: TopicId.fromString(profileTopicId),
            message: JSON.stringify(profileData),
            transactionId: TransactionId.generate(userAccountId) // User will pay
        });

        const frozenTx = await transaction.freezeWith(client);
        const base64Tx = Buffer.from(frozenTx.toBytes()).toString("base64");

        res.status(200).json({ unsignedTxBase64: base64Tx });
    } catch (error) {
        res.status(500).json({ message: "Error preparing transaction", error: error.toString() });
    }
});


// --- 4. GIG MANAGEMENT ---
// Endpoint to PREPARE a transaction for creating a gig on HCS
app.post("/gigs/prepare-creation", async (req, res) => {
    try {
        const { clientId, title, description, budget } = req.body;

        const gigData = {
            type: "GIG_CREATE",
            clientId,
            title,
            description,
            budget: `${budget} HBAR`,
            status: "OPEN",
            timestamp: new Date().toISOString()
        };

        const transaction = new TopicMessageSubmitTransaction({
            topicId: TopicId.fromString(gigsTopicId),
            message: JSON.stringify(gigData),
            transactionId: TransactionId.generate(clientId) // Client will pay
        });

        const frozenTx = await transaction.freezeWith(client);
        const base64Tx = Buffer.from(frozenTx.toBytes()).toString("base64");

        res.status(200).json({ unsignedTxBase64: base64Tx });
    } catch (error) {
        res.status(500).json({ message: "Error preparing transaction", error: error.toString() });
    }
});

// Endpoint to list all gigs (does not require a transaction)
app.get("/gigs", async (req, res) => { /* ... same as before ... */ });


// --- 5. ESCROW MANAGEMENT (TIED TO GIGS) ---
// NOTE: For a real app, you would use a database to link a gig's sequence number
// (from its HCS receipt) to the `escrowContractId` created for it.

// Endpoint to PREPARE the creation and initialization of an escrow contract for a gig
app.post("/escrow/prepare-creation", async (req, res) => {
    try {
        const { clientId, freelancerAccountId } = req.body;

        // This transaction is complex: it creates AND initializes the contract.
        // It's still paid for and signed by the client.
        const transaction = new ContractCreateFlow()
            .setBytecode(bytecode)
            .setGas(100000)
            .setConstructorParameters(
                new ContractFunctionParameters().addAddress(AccountId.fromString(freelancerAccountId).toEvmAddress())
            )
            .setTransactionId(TransactionId.generate(clientId));

        const frozenTx = await transaction.freezeWith(client);
        const base64Tx = Buffer.from(frozenTx.toBytes()).toString("base64");

        res.status(200).json({ unsignedTxBase64: base64Tx });
    } catch (error) {
        res.status(500).json({ message: "Error preparing escrow creation", error: error.toString() });
    }
});

// Endpoint to PREPARE locking funds in escrow
app.post("/escrow/prepare-lock", async (req, res) => {
    try {
        const { clientId, contractId, amount } = req.body;

        const transaction = new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(150000)
            .setFunction("lockFunds")
            .setPayableAmount(new Hbar(amount))
            .setTransactionId(TransactionId.generate(clientId));

        const frozenTx = await transaction.freezeWith(client);
        const base64Tx = Buffer.from(frozenTx.toBytes()).toString("base64");

        res.status(200).json({ unsignedTxBase64: base64Tx });
    } catch (error) {
        res.status(500).json({ message: "Error preparing lock transaction", error: error.toString() });
    }
});

// Endpoint to PREPARE releasing funds from escrow
app.post("/escrow/prepare-release", async (req, res) => {
    try {
        const { clientId, contractId } = req.body;

        const transaction = new ContractExecuteTransaction()
            .setContractId(contractId)
            .setGas(150000)
            .setFunction("releaseFunds")
            .setTransactionId(TransactionId.generate(clientId));

        const frozenTx = await transaction.freezeWith(client);
        const base64Tx = Buffer.from(frozenTx.toBytes()).toString("base64");

        res.status(200).json({ unsignedTxBase64: base64Tx });
    } catch (error) {
        res.status(500).json({ message: "Error preparing release transaction", error: error.toString() });
    }
});


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

const port = process.env.POST || 3000

app.listen(port, () => {
    console.log(`HireChain backend listening at http://localhost:${port}`);
});