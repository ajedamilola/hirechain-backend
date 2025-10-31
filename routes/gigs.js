import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Client, TopicMessageSubmitTransaction, TransactionId, ContractExecuteTransaction, ContractCreateTransaction, FileCreateTransaction, FileAppendTransaction, ContractId, Hbar, PrivateKey } from '@hashgraph/sdk';
import { Gig, Invitation, Profile, XP } from '../db/models.js';
import { gigsTopicId } from '../utils/env.js';
import { platformClient, myPrivateKey } from '../utils/hederaClient.js';
import { escrowBytecode } from '../utils/solidityCompiler.js';
import { sendEmail } from '../email_system/email_config.js';
import { getEntityIdFromTransaction } from '../utils/transactions.js';

const router = express.Router();

router.post('/gigs/prepare-creation', async (req, res) => {
  try {
    const { clientId, title, description, budget, duration, visibility } = req.body;
    if (!clientId || !title || !description || !budget) {
      return res.status(400).json({ message: 'Missing required gig fields.' });
    }
    const gigRefId = uuidv4();
    const gigVisibility = visibility || 'PUBLIC';
    const gigData = { type: 'GIG_CREATE', gigRefId, clientId, title, description, duration, budget: `${budget} HBAR`, status: 'OPEN', visibility: gigVisibility };

    const transaction = new TopicMessageSubmitTransaction({
      topicId: gigsTopicId,
      message: JSON.stringify(gigData),
      transactionId: TransactionId.generate(clientId),
    }).setTransactionId(TransactionId.generate(clientId)).freezeWith(Client.forTestnet());

    const encodedTransaction = Buffer.from(transaction.toBytes()).toString('base64');
    res.status(200).json({ encodedTransaction, gigData });
  } catch (error) {
    res.status(500).json({ message: 'Error preparing gig creation', error: error.toString() });
  }
});

// Record gig creation
router.post('/gigs/record-creation', async (req, res) => {
  try {
    const { gigData, hcsSequenceNumber } = req.body;
    await Gig.findOneAndUpdate(
      { gigRefId: gigData.gigRefId },
      { ...gigData, hcsSequenceNumber, escrowContractId: null, assignedFreelancerId: null },
      { upsert: true, new: true }
    );
    res.status(201).json({ message: 'Gig creation recorded.', gigRefId: gigData.gigRefId });
  } catch (error) {
    res.status(500).json({ message: 'Error recording gig', error: error.toString() });
  }
});

// Prepare assignment (upload bytecode and create HCS update)
router.post('/gigs/:gigRefId/prepare-assignment', async (req, res) => {
  try {
    const { gigRefId } = req.params;
    const { clientId, freelancerAccountId } = req.body;

    const gig = await Gig.findOne({ gigRefId });
    if (!gig || gig.clientId !== clientId || gig.status !== 'OPEN') {
      return res.status(403).json({ message: 'Invalid request or gig is not open.' });
    }

    const CHUNK_SIZE = 4096;
    let fileId;
    const fileKey = PrivateKey.fromStringECDSA(myPrivateKey);

    const fileCreateTx = new FileCreateTransaction()
      .setKeys([fileKey.publicKey])
      .setContents(escrowBytecode.substring(0, CHUNK_SIZE))
      .freezeWith(platformClient);

    const signedCreateTx = await fileCreateTx.sign(fileKey);
    const createTxResponse = await signedCreateTx.execute(platformClient);
    const createReceipt = await createTxResponse.getReceipt(platformClient);
    fileId = createReceipt.fileId;

    if (escrowBytecode.length > CHUNK_SIZE) {
      for (let i = CHUNK_SIZE; i < escrowBytecode.length; i += CHUNK_SIZE) {
        const chunk = escrowBytecode.substring(i, i + CHUNK_SIZE);
        const fileAppendTx = new FileAppendTransaction().setFileId(fileId).setContents(chunk).freezeWith(platformClient);
        const signedAppendTx = await fileAppendTx.sign(fileKey);
        await (await signedAppendTx.execute(platformClient)).getReceipt(platformClient);
      }
    }

    const contractCreateTx = new ContractCreateTransaction()
      .setBytecodeFileId(fileId)
      .setGas(10_000_000)
      .setTransactionId(TransactionId.generate(clientId))
      .freezeWith(Client.forTestnet());

    const updateGigData = { type: 'GIG_UPDATE', gigRefId, clientId, status: 'IN_PROGRESS', assignedFreelancerId: freelancerAccountId, timestamp: new Date().toISOString() };
    const updateHcsTx = new TopicMessageSubmitTransaction({
      topicId: gigsTopicId,
      message: JSON.stringify(updateGigData),
      transactionId: TransactionId.generate(clientId),
    }).setTransactionId(TransactionId.generate(clientId)).freezeWith(Client.forTestnet());

    const encodedContractTx = Buffer.from(contractCreateTx.toBytes()).toString('base64');
    const encodedHcsTx = Buffer.from(updateHcsTx.toBytes()).toString('base64');

    res.status(200).json({ encodedContractTx, encodedHcsTx, freelancerAccountId, updateGigData });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Error preparing assignment', error: error.toString() });
  }
});

router.post('/gigs/:gigRefId/record-assignment', async (req, res) => {
  try {
    const { gigRefId } = req.params;
    const { clientId, freelancerAccountId, updateGigData } = req.body;
    const gig = await Gig.findOne({ gigRefId });
    if (!gig) {
      return res.status(404).json({ message: 'Gig not found.' });
    }
    console.log({ status: 'IN_PROGRESS', assignedFreelancerId: freelancerAccountId })
    await Gig.findOneAndUpdate({ gigRefId }, { status: 'IN_PROGRESS', assignedFreelancerId: freelancerAccountId });
    res.status(200).json({ message: 'Assignment recorded successfully.' });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Error recording assignment', error: error.toString() });
  }
})

// Prepare lock escrow
router.post('/gigs/:gigRefId/prepare-lock-escrow', async (req, res) => {
  try {
    const { gigRefId } = req.params;
    const { clientId, amount } = req.body;
    const gig = await Gig.findOne({ gigRefId });

    const transaction = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(gig.escrowContractId))
      .setGas(1_050_000)
      .setFunction('lockFunds')
      .setPayableAmount(new Hbar(amount))
      .setTransactionId(TransactionId.generate(clientId))
      .freezeWith(Client.forTestnet());

    const encodedTransaction = Buffer.from(transaction.toBytes()).toString('base64');
    res.status(200).json({ encodedTransaction });
  } catch (error) {
    res.status(500).json({ message: 'Error preparing lock transaction', error: error.toString() });
  }
});

// Record lock escrow
router.post('/gigs/:gigRefId/record-lock-escrow', (req, res) => {
  console.log(`Lock recorded for gig ${req.params.gigRefId}`);
  res.status(200).json({ message: 'Lock-in successfully recorded.' });
});

// Prepare release escrow
router.post('/gigs/:gigRefId/prepare-release-escrow', async (req, res) => {
  try {
    const { gigRefId } = req.params;
    const { clientId } = req.body;
    const gig = await Gig.findOne({ gigRefId });

    const transaction = new ContractExecuteTransaction()
      .setContractId(ContractId.fromString(gig.escrowContractId))
      .setGas(1_050_000)
      .setFunction('releaseFunds')
      .setTransactionId(TransactionId.generate(clientId))
      .freezeWith(Client.forTestnet());

    const encodedTransaction = Buffer.from(transaction.toBytes()).toString('base64');
    res.status(200).json({ encodedTransaction });
  } catch (error) {
    res.status(500).json({ message: 'Error preparing release transaction', error: error.toString() });
  }
});

// Record release escrow
router.post('/gigs/:gigRefId/record-release-escrow', async (req, res) => {
  try {
    const { gigRefId } = req.params;
    const gig = await Gig.findOne({ gigRefId });

    await Gig.findOneAndUpdate({ gigRefId }, { status: 'COMPLETED' });

    const freelancerId = gig.assignedFreelancerId;
    if (freelancerId) {
      const xpToAward = 100;
      await XP.findOneAndUpdate(
        { userAccountId: freelancerId },
        { $inc: { xpPoints: xpToAward } },
        { upsert: true, new: true }
      );
      const freelancer = await Profile.findOne({ userAccountId: freelancerId });
      if (freelancer) {
        await sendEmail({ to: freelancer.email });
      }
    }
    res.status(200).json({ message: 'Escrow release recorded.' });
  } catch (error) {
    res.status(500).json({ message: 'Error recording release', error: error.toString() });
  }
});

// Public marketplace
router.get('/gigs', async (req, res) => {
  try {
    const { accountId } = req.query
    const allOpenGigs = await Gig.find({ status: 'OPEN', visibility: 'PUBLIC' }).sort({ createdAt: -1 });
    const openGigs = await Promise.all(allOpenGigs.map(async (gig) => {
      const invitation = await Invitation.findOne({ gigRefId: gig.gigRefId, freelancerId: accountId });
      let invitationStatus = "NOT_INVITED"
      if (invitation) {
        invitationStatus = invitation.status
      }
      return { ...gig.toObject(), invitationStatus }
    }))
    res.status(200).json(openGigs);
  } catch (error) {
    res.status(500).json({ message: 'Error listing open gigs', error: error.toString() });
  }
});

router.get("/myGigs", async (req, res) => {
  try {
    const { clientId } = req.query;
    const gigs = await Gig.find({ clientId }).sort({ createdAt: -1 });
    res.status(200).json(gigs);
  } catch (error) {
    res.status(500).json({ message: 'Error listing gigs', error: error.toString() });
  }
})

router.get("/myGigs/freelancer", async (req, res) => {
  try {
    const { freelancerId } = req.query;
    const gigs = await Gig.find({ assignedFreelancerId: freelancerId }).sort({ createdAt: -1 });
    res.status(200).json(gigs);
  } catch (error) {
    res.status(500).json({ message: 'Error listing gigs', error: error.toString() });
  }
})

// Get single gig
router.get('/gigs/:gigRefId', async (req, res) => {
  try {
    const { gigRefId } = req.params;
    const gig = await Gig.findOne({ gigRefId });
    const client = await Profile.findOne({ userAccountId: gig.clientId });
    const freelancer = await Profile.findOne({ userAccountId: gig.assignedFreelancerId });
    const invitation = await Invitation.findOne({ gigRefId: gig.gigRefId, freelancerId: gig.assignedFreelancerId });
    let invitationStatus = "NOT_INVITED"
    if (invitation) {
      invitationStatus = invitation.status
    }
    if (gig) return res.status(200).json({ ...gig.toObject(), client, freelancer, invitationStatus });
    res.status(404).json({ message: 'Gig not found.' });
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: 'Error fetching gig', error: error.toString() });
  }
});

export default router;
