import axios from 'axios';

export async function getEntityIdFromTransaction(transactionId) {
  const input = transactionId;
  const regex = /@(\d+)\.(\d+)/;
  const replacement = '-$1-$2';
  const formattedId = input.replace(regex, replacement);
  const url = `https://testnet.mirrornode.hedera.com/api/v1/transactions/${formattedId}`;

  for (let i = 0; i < 5; i++) {
    try {
      const response = await axios.get(url);
      if (response.data && response.data?.transactions && response.data?.transactions[0]?.entity_id) {
        return response.data.transactions[0]?.entity_id;
      } else {
        throw new Error(`Transaction failed with status: ${response.data.result}`);
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        throw error;
      }
    }
  }
  throw new Error(`Could not find a successful transaction record for ${transactionId} after multiple attempts.`);
}
