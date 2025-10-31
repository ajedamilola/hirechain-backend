# HireChain Backend (Hedera Service Layer)

This repository contains the backend service layer for the HireChain Decentralized Freelancer Marketplace that is designed to Bridge the financial gaps across Africa by making blockchain technology more accessible. It is responsible for all direct interactions with the Hedera network, managing secure transactions, data indexing, and off-chain data caching via MongoDB for high-traffic operations.

The core service is built on Node.js and uses the Hedera JavaScript SDK to perform operations like creating HCS messages, initiating HTS payments, and interacting with the Escrow Smart Contract.

## 🚀 Getting Started

### Prerequisites

1.  **Node.js:** (LTS recommended)
2.  **MongoDB:** Running locally or accessible via a cloud URI.
3.  **Hedera Account:** An active Hedera mainnet or testnet account (required for the Treasury, which will fund transaction fees).

### 1. Project Setup

Clone the repository and install the necessary dependencies:

```bash
git clone [BACKEND_REPO_URL]
cd hirechain-backend
npm install
```

### 2. Configuration (`.env` File)

Create a file named `.env` in the root of the `hirechain-backend` directory and populate it with your configuration settings.

This file holds critical Hedera account keys and service endpoints. **Never commit this file to a public repository.**

```env
# Hedera Configuration
# This is the platform's primary funded account for paying transaction fees (The Treasury).
# Replace xxxxx and xxxxxxxxx with your actual values.
TREASURY_ACCOUNT_ID=0.0.xxxxx
TREASURY_PRIVATE_KEY=302e020100300506032b657004220420xxxxxxxx
NETWORK=testnet # or mainnet

# Hedera Topic IDs (Will be populated after running create-topic.js)
HIRECHAIN_PROFILE_TOPIC_ID=
HIRECHAIN_GIGS_TOPIC_ID=
HIRECHAIN_MESSAGES_TOPIC_ID=

# NFT Token IDs (Will be populated after running the badge creation script, if separate)
HIRECHAIN_BRONZE_BADGE_TOKEN_ID=
HIRECHAIN_SILVER_BADGE_TOKEN_ID=
HIRECHAIN_GOLD_BADGE_TOKEN_ID=

# Hedera Smart Contract IDs (Will be populated after running deploy-contract.js)
HIRECHAIN_ESCROW_CONTRACT_ID=

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/hirechain

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 3. Hedera Pre-requisite Setup

Before running the server, you need to set up the core Hedera resources (HCS Topics and the Escrow Smart Contract).

#### **A. Create Hedera Consensus Service (HCS) Topics**

These topics are the immutable, transparent logs for reputation and project history.

```bash
node create-topic.js
```

This script will output the created `HIRECHAIN_PROFILE_TOPIC_ID`, `HIRECHAIN_GIGS_TOPIC_ID`, and `HIRECHAIN_MESSAGES_TOPIC_ID`. **You must copy these IDs back into your `.env` file.**

#### **B. Compile and Deploy Escrow Smart Contract**

The Solidity smart contract handles the trustless HBAR escrow for transactions.

```bash
node deploy-contract.js
```

This script compiles the Solidity code, deploys it to the Hedera EVM via the Smart Contract Service (HSCS), and outputs the `HIRECHAIN_ESCROW_CONTRACT_ID`. **You must copy this ID back into your `.env` file.**

#### **C. Create NFT Badge Tokens (Optional - if separate)**

_(Note: If NFT creation is part of the `deploy-contract.js` or another script, adjust this step.)_

---

### 4. Running the Backend Server

Once all your `.env` variables (including the new Hedera IDs) are set, start the backend service:

```bash
node index.js
```

The server will be running on the specified port (e.g., `http://localhost:3000`).

## 🛠 Architecture & Data Flow

The backend serves two main purposes:

1.  **Hedera Interaction:** It processes requests from the frontend, executes secure operations (HTS payments, HSCS escrow calls, HCS logging) via the Hedera SDK, and returns the result.
2.  **Fast Data Indexing:** Since HCS is used for immutable logging and can be slower to query for displaying large lists, MongoDB acts as a **mirror and cache**. The backend subscribes to the HCS topics and stores essential, frequently-queried data (like profiles and gig summaries) in MongoDB to ensure a snappy user experience for the high-traffic application. **All critical data remains verifiable on-chain.**

| Component                | Role                | Purpose                                                                                        |
| :----------------------- | :------------------ | :--------------------------------------------------------------------------------------------- |
| **Node.js Server**       | API Gateway & Logic | Handles routing, authorization, and business logic.                                            |
| **Hedera SDK**           | DLT Interface       | Communicates with HCS, HTS, and HSCS.                                                          |
| **MongoDB**              | Fast Cache/Index    | Stores parsed HCS data (profiles, gig summaries) for fast query and retrieval by the frontend. |
| **`create-topic.js`**    | Setup Script        | Creates the core HCS Topics for transparent logging.                                           |
| **`deploy-contract.js`** | Setup Script        | Compiles and deploys the Solidity Escrow contract to HSCS.                                     |
