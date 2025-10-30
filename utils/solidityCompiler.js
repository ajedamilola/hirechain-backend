import fs from 'fs';
import path from 'path';
import solc from 'solc';

// Compile the escrow smart contract once and export bytecode
const contractSource = fs.readFileSync(path.join('.', 'Escrow.sol'), 'utf8');
const input = {
  language: 'Solidity',
  sources: { 'Escrow.sol': { content: contractSource } },
  settings: { outputSelection: { '*': { '*': ['*'] } } },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (!output.contracts || !output.contracts['Escrow.sol'] || !output.contracts['Escrow.sol']['HireChainEscrow']) {
  throw new Error('Failed to compile Escrow.sol: HireChainEscrow contract not found');
}

export const escrowBytecode = output.contracts['Escrow.sol']['HireChainEscrow'].evm.bytecode.object;
