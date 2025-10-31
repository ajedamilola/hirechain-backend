import express from 'express';
import { Message, Gig } from '../db/models.js';
import { TopicMessageSubmitTransaction, TransactionId, Client } from '@hashgraph/sdk';
import { profileTopicId } from '../utils/env.js';

const router = express.Router();

// Get the message history for a specific gig
router.get('/gigs/:gigRefId/messages', async (req, res) => {
  try {
    const { gigRefId } = req.params;
    const gig = await Gig.findOne({ gigRefId });
    if (!gig) {
      return res.status(404).json({ message: 'Gig not found.' });
    }
    const gigMessages = await Message.find({ gigRefId }).sort({ timestamp: 1 });
    res.status(200).json(gigMessages);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching messages', error: error.toString() });
  }
});

// Post a message to a gig (prepares HCS submit)
router.post('/gigs/:gigRefId/message', async (req, res) => {
  try {
    const { gigRefId } = req.params;
    const { message, senderId } = req.body;
    const gig = await Gig.findOne({ gigRefId });
    if (!gig) {
      return res.status(404).json({ message: 'Gig not found.' });
    }
    const newMessage = new Message({ gigRefId, senderId, content: message, timestamp: new Date() });
    await newMessage.save();

    const messageCreateTransaction = new TopicMessageSubmitTransaction({
      topicId: profileTopicId,
      message: JSON.stringify(newMessage),
      transactionId: TransactionId.generate(senderId),
    }).setTransactionId(TransactionId.generate(senderId));

    const messageCreateTransactionBytes = messageCreateTransaction.toBytes();
    const messageCreateTransactionBase64 = Buffer.from(messageCreateTransactionBytes).toString('base64');
    res.status(200).json({ messageCreateTransactionBase64 });
  } catch (error) {
    res.status(500).json({ message: 'Error sending message', error: error.toString() });
  }
});

export default router;
