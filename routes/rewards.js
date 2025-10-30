import express from 'express';
import { TokenAssociateTransaction, TokenMintTransaction, TransferTransaction } from '@hashgraph/sdk';
import { Reward, XP } from '../db/models.js';
import { platformClient, myAccountId } from '../utils/hederaClient.js';
import { rewardTiers } from '../services/rewards.service.js';

const router = express.Router();

// Prepare association
router.post('/rewards/prepare-association', async (req, res) => {
  try {
    const { accountId, rewardId } = req.body;
    const tier = rewardTiers[rewardId];
    const userXP = await XP.findOne({ userAccountId: accountId });
    const existingReward = await Reward.findOne({ userAccountId: accountId, rewardId });

    if (!tier || (userXP?.xpPoints || 0) < tier.xpRequired || existingReward) {
      return res.status(403).json({ message: 'Not eligible for this reward.' });
    }

    const transaction = new TokenAssociateTransaction()
      .setAccountId(accountId)
      .setTokenIds([tier.tokenId])
      .freeze();

    const encodedTransaction = Buffer.from(transaction.toBytes()).toString('base64');
    res.status(200).json({ encodedTransaction });
  } catch (error) {
    res.status(500).json({ message: 'Error preparing association', error: error.toString() });
  }
});

// Mint and transfer (platform-paid)
router.post('/rewards/mint-and-transfer', async (req, res) => {
  try {
    const { accountId, rewardId } = req.body;
    const tier = rewardTiers[rewardId];

    const mintTx = await new TokenMintTransaction()
      .setTokenId(tier.tokenId)
      .setMetadata([Buffer.from(`ipfs://.../${rewardId}`)])
      .execute(platformClient);
    const mintReceipt = await mintTx.getReceipt(platformClient);
    const serialNumber = mintReceipt.serials[0].low;

    const transferTx = await new TransferTransaction()
      .addNftTransfer(tier.tokenId, serialNumber, myAccountId, accountId)
      .execute(platformClient);
    await transferTx.getReceipt(platformClient);

    await Reward.create({ userAccountId: accountId, rewardId, tokenId: tier.tokenId, serialNumber });

    res.status(200).json({ message: 'Reward NFT minted and transferred!', tokenId: tier.tokenId, serialNumber });
  } catch (error) {
    res.status(500).json({ message: 'Error minting reward', error: error.toString() });
  }
});

export default router;
