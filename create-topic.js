// create-topic.js
import { Client, PrivateKey, AccountId, TopicCreateTransaction } from "@hashgraph/sdk";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const myAccountId = process.env.TREASURY_ACCOUNT_ID;
  const myPrivateKey = process.env.TREASURY_PRIVATE_KEY;

  if (!myAccountId || !myPrivateKey) {
    throw new Error("TREASURY_ACCOUNT_ID and TREASURY_PRIVATE_KEY must be present in .env file");
  }

  const client = Client.forTestnet();
  client.setOperator(AccountId.fromString(myAccountId), PrivateKey.fromStringECDSA(myPrivateKey));

  //Create a new topic
  let txResponse = await new TopicCreateTransaction().execute(client);

  //Get the receipt of the transaction
  let receipt = await txResponse.getReceipt(client);

  //Get the topic ID
  const newTopicId = receipt.topicId;

  console.log("The new topic ID is: " + newTopicId);
  console.log(`\nAdd this to your .env file as: HIRECHAIN_TOPIC_ID=${newTopicId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});