const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

// --- Configuration & Security ---
// It is CRITICAL to load sensitive information from environment variables.
// In a production environment, you would use a package like 'dotenv' locally,
// but deployment platforms typically inject these variables directly.
const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const DESTINATION_ADDRESS = process.env.SWEEP_DESTINATION_ADDRESS || '0xRecipientAddressGoesHere';
// Using a placeholder public endpoint. Replace with your Infura/Alchemy URL in production.
const ETHERS_PROVIDER_URL = process.env.ETHERS_PROVIDER_URL || 'https://cloudflare-eth.com'; 

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Provider and Wallet
const provider = new ethers.providers.JsonRpcProvider(ETHERS_PROVIDER_URL);

// The signer (Wallet) is used to sign and send transactions.
let treasuryWallet;
if (!PRIVATE_KEY) {
    console.error("FATAL ERROR: TREASURY_PRIVATE_KEY is not set. Sweep functionality will not work.");
    // Use a placeholder object if the key is missing to prevent immediate crash
    treasuryWallet = { 
        address: '0xTreasuryWalletPlaceholder', 
        sendTransaction: async () => { throw new Error("Wallet not initialized: Missing private key."); },
        getBalance: async () => ethers.utils.parseEther("0.0") 
    };
} else {
    // Initialize the wallet using the private key and the provider
    treasuryWallet = new ethers.Wallet(PRIVATE_KEY, provider); 
}


// --- Middleware ---
app.use(cors()); // Enable CORS for all routes (important for front-end access)
app.use(express.json()); // Enable JSON body parsing for POST requests

// Middleware for basic logging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});


// --- Routes ---

/**
 * @route GET /health
 * @description Simple health check route to verify server status.
 */
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        version: '1.0.0', 
        walletAddress: treasuryWallet.address,
        isSweepConfigured: !!PRIVATE_KEY 
    });
});

/**
 * @route POST /api/sweep/eth
 * @description Initiates the process to sweep all available ETH from the treasury wallet
 * to the configured destination address.
 */
app.post('/api/sweep/eth', async (req, res) => {
    if (!PRIVATE_KEY) {
        return res.status(503).json({ 
            error: "Service Unavailable: Server is not configured for sweeping (private key missing)." 
        });
    }

    try {
        // Allow destination to be overridden in the request body for flexibility
        const destination = req.body.destination || DESTINATION_ADDRESS;
        if (!ethers.utils.isAddress(destination)) {
            return res.status(400).json({ error: "Invalid destination address provided." });
        }

        // 1. Get current balance and gas price
        const balance = await treasuryWallet.getBalance();
        const gasPrice = await provider.getGasPrice();
        
        // Use a standard gas limit for simple ETH transfers
        const gasLimit = ethers.BigNumber.from(21000); 
        
        // Calculate the maximum transaction fee (gasPrice * gasLimit)
        const gasCost = gasPrice.mul(gasLimit);

        // Check for sufficient balance to cover the gas fee
        if (balance.lt(gasCost)) {
            console.log(`Balance too low. Balance: ${ethers.utils.formatEther(balance)} ETH, Gas Cost: ${ethers.utils.formatEther(gasCost)} ETH`);
            return res.status(200).json({ 
                message: "Balance is too low to cover the transaction gas cost.",
                balance: ethers.utils.formatEther(balance),
                gasCost: ethers.utils.formatEther(gasCost)
            });
        }
        
        // 2. Calculate the amount to send (Total balance - Gas Cost)
        const amountToSend = balance.sub(gasCost);

        if (amountToSend.isZero()) {
             return res.status(200).json({ 
                message: "Calculated sweep amount is zero after deducting gas.",
                balance: ethers.utils.formatEther(balance)
            });
        }

        // 3. Construct and send the transaction
        const tx = {
            to: destination,
            value: amountToSend,
            gasPrice: gasPrice,
            gasLimit: gasLimit,
        };

        console.log(`Sweeping ${ethers.utils.formatEther(amountToSend)} ETH to ${destination}`);
        const transactionResponse = await treasuryWallet.sendTransaction(tx);

        // 4. Respond to the user
        res.status(200).json({
            message: 'ETH sweep transaction submitted successfully.',
            transactionHash: transactionResponse.hash,
            amountSent: ethers.utils.formatEther(amountToSend),
            destination: destination,
            // Provide a network link (e.g., Etherscan) for verification
            networkLink: `https://etherscan.io/tx/${transactionResponse.hash}` 
        });

    } catch (error) {
        console.error('Sweep failed:', error);
        // Respond with a 500 status and details about the failure
        res.status(500).json({ 
            error: 'Failed to execute ETH sweep transaction.', 
            details: error.reason || error.message 
        });
    }
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`Crypto Treasury Server running on port ${PORT}`);
    console.log(`Treasury Wallet Address: ${treasuryWallet.address}`);
    if (!PRIVATE_KEY) {
        console.log("WARNING: Set TREASURY_PRIVATE_KEY environment variable to enable sweeping.");
    }
});
