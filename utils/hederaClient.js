import { Client, AccountId, PrivateKey } from '@hashgraph/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

export const myAccountId = process.env.TREASURY_ACCOUNT_ID;
export const myPrivateKey = process.env.TREASURY_PRIVATE_KEY;

if (!myAccountId || !myPrivateKey) {
  throw new Error('TREASURY_ACCOUNT_ID and TREASURY_PRIVATE_KEY are required');
}

// Main client for platform-paid transactions (arbiter/treasury)
export const platformClient = Client.forTestnet();
platformClient.setOperator(AccountId.fromString(myAccountId), PrivateKey.fromStringECDSA(myPrivateKey));
