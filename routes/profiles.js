import express from 'express';
import { PrivateKey, AccountCreateTransaction, Hbar, TopicMessageSubmitTransaction, Client, TransactionId } from '@hashgraph/sdk';
import { Profile, Gig } from '../db/models.js';
import { profileTopicId } from '../utils/env.js';
import { platformClient } from '../utils/hederaClient.js';

const router = express.Router();

// NOTE: Account creation is a special case. The platform pays for it, so it happens here.
// The frontend will then use the returned keys to sign the profile creation.
router.post('/users/create-account', async (req, res) => {
  try {
    const newAccountPrivateKey = PrivateKey.generateED25519();
    const newAccountPublicKey = newAccountPrivateKey.publicKey;
    const newAccountTx = await new AccountCreateTransaction()
      .setKey(newAccountPublicKey)
      .setInitialBalance(new Hbar(10))
      .execute(platformClient);

    const receipt = await newAccountTx.getReceipt(platformClient);
    const newAccountId = receipt.accountId;

    res.status(201).json({
      message: 'Account created! Securely store the private key.',
      accountId: newAccountId.toString(),
      privateKey: newAccountPrivateKey.toStringRaw(),
    });
  } catch (error) {
    res.status(500).json({ message: 'Account creation failed', error: error.toString() });
  }
});

router.post('/users/prepare-profile-creation', async (req, res) => {
  try {
    const { accountId, name, skills, portfolioUrl, email, profileType } = req.body;
    if (!accountId || !name || !skills || !email || !profileType) {
      return res.status(400).json({ message: 'All profile fields are required.' });
    }

    const profileData = { type: 'PROFILE_CREATE', userAccountId: accountId, name, skills, portfolioUrl, email, profileType };
    const transaction = new TopicMessageSubmitTransaction({
      topicId: profileTopicId,
      message: JSON.stringify(profileData),
      transactionId: TransactionId.generate(accountId),
    })
      .setTransactionId(TransactionId.generate(accountId))
      .freezeWith(Client.forTestnet());

    const encodedTransaction = Buffer.from(transaction.toBytes()).toString('base64');
    res.status(200).json({ encodedTransaction, profileData });
  } catch (error) {
    res.status(500).json({ message: 'Error preparing profile transaction', error: error.toString() });
  }
});

router.post('/users/record-profile-creation', async (req, res) => {
  try {
    const { profileData } = req.body;
    if (!profileData || !profileData.userAccountId) {
      return res.status(400).json({ message: 'Profile data is required.' });
    }
    await Profile.findOneAndUpdate(
      { userAccountId: profileData.userAccountId },
      profileData,
      { upsert: true, new: true }
    );
    res.status(201).json({ message: 'Profile successfully recorded.' });
  } catch (error) {
    res.status(500).json({ message: 'Error recording profile', error: error.toString() });
  }
});

// Endpoint to fetch all gigs a specific user is involved in (for their dashboard)
router.get('/users/:accountId/gigs', async (req, res) => {
  try {
    const { accountId } = req.params;
    if (!accountId) {
      return res.status(400).json({ message: 'Account ID is required to fetch user gigs.' });
    }
    const userGigs = await Gig.find({
      $or: [{ clientId: accountId }, { assignedFreelancerId: accountId }],
    }).sort({ createdAt: -1 });
    res.status(200).json(userGigs);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching user-specific gigs', error: error.toString() });
  }
});

// Get a user's profile by their account ID
router.get('/users/profile/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const profile = await Profile.findOne({ userAccountId: accountId });
    if (profile) {
      return res.status(200).json(profile);
    }
    res.status(404).json({ message: 'Profile not found for this account.' });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching profile', error: error.toString() });
  }
});

export default router;
