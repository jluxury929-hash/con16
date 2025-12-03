const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

// --- Configuration & Security ---
const PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const DESTINATION_ADDRESS = process.env.SWEEP_DESTINATION_ADDRESS || '0xRecipientAddressGoesHere';
const ETHERS_PROVIDER_URL = process.env.ETHERS_PROVIDER_URL || 'https://cloudflare-eth.com';

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------ ETHERS v6 FIXES ------------------
// v5: new ethers.providers.JsonRpcProvider()
// v6: new ethers.JsonRpcProvider()
const provider = new ethers.JsonRpcProvider(ETHERS_PROVIDER_URL);

// Wallet initialization
let treasuryWallet;

if (!PRIVATE_KEY) {
    console.error("FATAL ERROR: TREASURY_PRIVATE_KEY is not set.");

    treasuryWallet = { 
        address: '0xTreasuryWalletPlaceholder',
        sendTransaction: async () => { throw new Error("Wallet not initialized."); },
        getBalance: async () => 0n 
    };
} else {
    treasuryWallet = new ethers.Wallet(PRIVATE_KEY, provider);
}

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// ─────────────────────────────────────────────
// GET /health
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok',
        version: '1.0.0',
        walletAddress: treasuryWallet.address,
        isSweepConfigured: !!PRIVATE_KEY 
    });
});

// ─────────────────────────────────────────────
// POST /api/sweep/eth
// Sweeps all ETH from wallet (minus gas)
// ─────────────────────────────────────────────
app.post('/api/sweep/eth', async (req, res) => {
    if (!PRIVATE_KEY) {
        return res.status(503).json({ 
            error: "Service Unavailable: Missing private key." 
        });
    }

    try {
        const destination = req.body.destination || DESTINATION_ADDRESS;

        // v6: ethers.isAddress()
        if (!ethers.isAddress(destination)) {
            return res.status(400).json({ error: "Invalid destination address." });
        }

        // 1. Retrieve balance & gas price
        const balance = await treasuryWallet.getBalance();  // returns bigint in v6
        const gasPrice = await provider.getGasPrice();      // bigint

        const gasLimit = 21000n;
        const gasCost = gasPrice * gasLimit;

        // Not enough ETH to pay gas
        if (balance < gasCost) {
            return res.status(200).json({
                message: "Balance is too low to cover gas.",
                balance: ethers.formatEther(balance),
                gasCost: ethers.formatEther(gasCost)
            });
        }

        // 2. Calculate amount to send
        const amountToSend = balance - gasCost;

        if (amountToSend <= 0n) {
            return res.status(200).json({
                message: "Sweep amount is zero after gas deduction.",
                balance: ethers.formatEther(balance)
            });
        }

        // 3. Create the transaction (v6 syntax)
        const tx = {
            to: destination,
            value: amountToSend,
            gasPrice: gasPrice,
            gasLimit: gasLimit
        };

        console.log(`Sweeping ${ethers.formatEther(amountToSend)} ETH → ${destination}`);

        const txResponse = await treasuryWallet.sendTransaction(tx);

        // 4. Response
        res.status(200).json({
            message: "Sweep transaction submitted.",
            transactionHash: txResponse.hash,
            amountSent: ethers.formatEther(amountToSend),
            destination: destination,
            networkLink: `https://etherscan.io/tx/${txResponse.hash}`
        });

    } catch (err) {
        console.error("Sweep failed:", err);

        res.status(500).json({
            error: "Sweep transaction failed.",
            details: err?.reason || err?.message || String(err)
        });
    }
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`Crypto Treasury Server running on port ${PORT}`);
    console.log(`Treasury Wallet Address: ${treasuryWallet.address}`);

    if (!PRIVATE_KEY) {
        console.log("WARNING: Set TREASURY_PRIVATE_KEY to enable sweeping.");
    }
});

