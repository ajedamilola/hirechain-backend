import {
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  PrivateKey,
  Client
} from "@hashgraph/sdk";

/**
* Creates a new NFT Collection (Token) on the Hedera network.
* @param {Client} client The Hedera client object, pre-configured with the operator/payer.
* @param {string} tokenName The name of the NFT collection (e.g., "HireChain Bronze Badge").
* @param {string} tokenSymbol The symbol for the collection (e.g., "HCBF").
* @param {string} treasuryAccountId The account ID that will own the collection.
* @param {PrivateKey} supplyKey The private key that is authorized to mint new NFTs.
* @returns {Promise<string>} The ID of the newly created token.
*/
export async function createNftCollection(client, tokenName, tokenSymbol, treasuryAccountId, supplyKey) {
  try {
    console.log(`Creating NFT collection: ${tokenName} (${tokenSymbol})`);

    // Create the transaction for the new token
    const createTokenTx = await new TokenCreateTransaction()
      .setTokenName(tokenName)
      .setTokenSymbol(tokenSymbol)
      .setTokenType(TokenType.NonFungibleUnique)
      .setSupplyType(TokenSupplyType.Infinite) // We can mint as many as we need
      .setDecimals(0) // NFTs have 0 decimals
      .setInitialSupply(0) // We will mint NFTs later
      .setTreasuryAccountId(treasuryAccountId)
      .setSupplyKey(supplyKey) // The key that can mint more NFTs
      .setAdminKey(supplyKey) // The key that can modify the token
      .freezeWith(client);

    // Sign the transaction with the treasury key
    const signedTx = await createTokenTx.sign(PrivateKey.fromStringECDSA(process.env.TREASURY_PRIVATE_KEY));

    // Execute the transaction
    const txResponse = await signedTx.execute(client);

    // Get the receipt
    const receipt = await txResponse.getReceipt(client);

    // Get the new token ID from the receipt
    const tokenId = receipt.tokenId;

    console.log(`- SUCCESS! Token ID: ${tokenId}`);
    return tokenId.toString();

  } catch (error) {
    console.error(`Error creating NFT collection "${tokenName}":`, error);
    throw error;
  }
}