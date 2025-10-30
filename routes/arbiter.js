import express from 'express';
import { ContractExecuteTransaction } from '@hashgraph/sdk';
import { platformClient } from '../utils/hederaClient.js';

const router = express.Router();

// Keep original path typo to avoid breaking clients
router.post('/arbister/release', async (req, res) => {
  try {
    const { contractId } = req.body;
    if (!contractId) {
      return res.status(400).json({ message: 'Contract ID is required.' });
    }

    const releaseTx = await new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(150000)
      .setFunction('releaseFunds')
      .execute(platformClient);

    await releaseTx.getReceipt(platformClient);
    res.status(200).json({ message: `Arbiter successfully released funds from contract ${contractId}.` });
  } catch (error) {
    console.error('Arbiter error releasing funds:', error);
    res.status(500).json({ message: 'Arbiter error releasing funds', error: error.toString() });
  }
});

router.post('/arbiter/cancel', async (req, res) => {
  try {
    const { contractId } = req.body;
    if (!contractId) {
      return res.status(400).json({ message: 'Contract ID is required.' });
    }

    const cancelTx = await new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(150000)
      .setFunction('cancelEscrow')
      .execute(platformClient);

    await cancelTx.getReceipt(platformClient);
    res.status(200).json({ message: `Arbiter successfully cancelled escrow for contract ${contractId}.` });
  } catch (error) {
    console.error('Arbiter error cancelling escrow:', error);
    res.status(500).json({ message: 'Arbiter error cancelling escrow', error: error.toString() });
  }
});

export default router;
