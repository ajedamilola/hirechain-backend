// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/**
 * @title HireChainEscrow
 * @dev This is the final, arbitrated escrow contract for the HireChain platform.
 * It allows a trusted arbiter (the platform) to resolve disputes by releasing
 * or cancelling the escrow. It uses the robust .call() method for HBAR transfers.
 *
 * State Machine: Created -> Initialized -> Locked -> (Released | Cancelled)
 */
contract HireChainEscrow {
    // --- State Variables ---

    // The platform's trusted account for resolving disputes.
    address public arbiter;

    // The party hiring the freelancer (funds the escrow).
    address payable public client;

    // The party doing the work (receives the funds).
    address payable public freelancer;

    // The amount of HBAR held in escrow.
    uint public amount;

    // The current state of the escrow.
    enum State { Created, Initialized, Locked, Released, Cancelled }
    State public currentState;


    // --- Events ---

    // Emitted when the client locks funds into the contract.
    event FundsLocked(address indexed client, uint amount);

    // Emitted when funds are successfully released to the freelancer.
    event FundsReleased(address indexed freelancer, uint amount);

    // Emitted when the escrow is cancelled and funds are returned to the client.
    event EscrowCancelled(address indexed client, uint amount);

    // Emitted when a new escrow instance is configured for a client and freelancer.
    event EscrowInitialized(address indexed client, address indexed freelancer);


    /**
     * @dev The constructor is called only once when the master contract logic is deployed.
     * It permanently sets the 'arbiter' to be the account that deployed it.
     */
    constructor() {
        arbiter = msg.sender;
        currentState = State.Created;
    }

    /**
     * @dev Initializes a new escrow instance, setting the client and freelancer.
     * This must be called before any other actions can occur.
     * @param _freelancer The Hedera address of the freelancer for this gig.
     */
    function initEscrow(address payable _freelancer) public {
        // CHECKS
        require(currentState == State.Created, "Escrow already initialized.");
        
        // EFFECTS
        client = payable(msg.sender); // The caller of this function is the client
        freelancer = _freelancer;
        currentState = State.Initialized;
        
        // INTERACTIONS
        emit EscrowInitialized(client, freelancer);
    }

    /**
     * @dev The client calls this function to deposit and lock HBAR into the contract.
     * The `payable` keyword allows this function to receive HBAR.
     */
    function lockFunds() public payable {
        // CHECKS
        require(currentState == State.Initialized, "Escrow must be initialized before locking.");
        require(msg.sender == client, "Only the client can lock funds.");
        require(msg.value > 0, "Must send HBAR to lock.");

        // EFFECTS
        amount = msg.value;
        currentState = State.Locked;

        // INTERACTIONS
        emit FundsLocked(client, amount);
    }

    /**
     * @dev Releases the locked funds to the freelancer.
     * Can only be called by the client (approving the work) or the arbiter (resolving a dispute).
     */
    function releaseFunds() public {
        // 1. Checks
        require(currentState == State.Locked, "Funds are not locked.");
        require(msg.sender == client || msg.sender == arbiter, "Only client or arbiter can release.");

        // 2. Effects (Update state BEFORE the external call to prevent re-entrancy)
        currentState = State.Released;

        // 3. Interaction
        // Use .call() to forward all available gas. This is the modern, robust way.
        (bool success, ) = freelancer.call{value: amount}("");
        require(success, "Failed to send HBAR to freelancer.");
        
        emit FundsReleased(freelancer, amount);
    }

    /**
     * @dev Cancels the escrow and refunds the HBAR to the client.
     * Can be called by the client, the freelancer, or the arbiter.
     */
    function cancelEscrow() public {
        // 1. Checks
        require(currentState == State.Locked, "Funds must be locked to be cancelled.");
        require(msg.sender == client || msg.sender == freelancer || msg.sender == arbiter, "Only parties or arbiter can cancel.");

        // 2. Effects (Update state BEFORE the external call)
        currentState = State.Cancelled;
        
        // 3. Interaction
        // Use .call() here as well for consistency and robustness.
        (bool success, ) = client.call{value: amount}("");
        require(success, "Failed to refund HBAR to client.");

        emit EscrowCancelled(client, amount);
    }
}