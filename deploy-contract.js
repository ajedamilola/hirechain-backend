// deploy-contract.js
import {
  Client,
  PrivateKey,
  AccountId,
  ContractCreateFlow, // Easiest way to deploy
  Hbar,
  ContractByteCodeQuery
} from "@hashgraph/sdk";
// import * as dotenv from "dotenv";
import "dotenv/config"
import fs from "fs";
import solc from "solc";

// dotenv.config();

async function main() {
  const myAccountId = process.env.TREASURY_ACCOUNT_ID;
  const myPrivateKey = process.env.TREASURY_PRIVATE_KEY;

  console.log(myAccountId)
  console.log(myPrivateKey)

  if (!myAccountId || !myPrivateKey) {
    throw new Error("TREASURY_ACCOUNT_ID and TREASURY_PRIVATE_KEY must be in .env");
  }

  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(myAccountId), PrivateKey.fromStringECDSA(myPrivateKey));
  // client.setDefaultMaxTransactionFee(new Hbar(1000000)); // Set a high gas limit

  // 1. --- Compile the contract ---
  console.log("Compiling contract...");
  const contractSource = fs.readFileSync("Escrow.sol", "utf8");

  const input = {
    language: "Solidity",
    sources: { "Escrow.sol": { content: contractSource } },
    settings: { outputSelection: { "*": { "*": ["*"] } } },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const bytecode = output.contracts["Escrow.sol"]["HireChainEscrow"].evm.bytecode.object;

  console.log(bytecode.length)
  console.log("Compilation successful.");

  // 2. --- Deploy the contract ---
  // NOTE: We don't pass constructor params here. Each escrow will be a NEW contract.
  // This script just deploys the "master" bytecode.
  console.log("\nDeploying contract...");
  const contractDeployTx = new ContractCreateFlow()
    .setBytecode(bytecode)
    .setGas(10_000_000); // Gas fee to execute the transaction

  const txResponse = await contractDeployTx.execute(client);
  const receipt = await txResponse.getReceipt(client);
  const newContractId = receipt.contractId;

  console.log("--- Deployment Successful ---");
  console.log("The new contract ID is: " + newContractId);
  console.log(`\nAdd this to your .env file as: ESCROW_CONTRACT_ID=${newContractId}`);
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});