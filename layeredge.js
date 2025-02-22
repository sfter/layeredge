import { ethers } from 'ethers';
import fs from 'fs';
import axios from 'axios';
import moment from 'moment';
import momentlog from 'moment-timezone'

const BASE_URL = 'https://referralapi.layeredge.io/api';
const HEADERS = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'en-GB,en;q=0.8',
    'cache-control': 'no-cache',
    'content-type': 'application/json',
    'origin': 'https://dashboard.layeredge.io',
    'pragma': 'no-cache',
    'priority': 'u=1, i',
    'referer': 'https://dashboard.layeredge.io/',
    'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'sec-gpc': '1',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
};

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function readWallets() {
    try {
        await fs.accessSync("wallets.json");
        const data = await fs.readFileSync("wallets.json", "utf-8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.info("No wallets found in wallets.json");
            return [];
        }
        throw err;
    }
}

async function readReffCodes() {
    try {
        await fs.accessSync("wallets.json");
        const data = await fs.readFileSync("reffCodes.json", "utf-8");
        return JSON.parse(data);
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.info("No wallets found in wallets.json");
            return [];
        }
        throw err;
    }
}

function logToReadme(log) {
    const logEntry = `${log}\n`;
    fs.appendFileSync('log-layeredge.txt', logEntry, 'utf8');
    console.log(log);
}
function timelog() {
  return momentlog().tz('Asia/Jakarta').format('HH:mm:ss | DD-MM-YYYY');
}
async function checkWallet(walletAddress) {
    try {
        const response = await axios.get(`${BASE_URL}/referral/wallet-details/${walletAddress}`, { headers: HEADERS });
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            return null;
        }
        throw error;
    }
}

async function validateInviteCode(inviteCode) {
    try {
        const response = await axios.post(`${BASE_URL}/referral/verify-referral-code`, { invite_code: inviteCode }, { headers: HEADERS });
        return response.data.data.valid;
    } catch (error) {
        return false;
    }
}

async function registerWallet(walletAddress, inviteCode) {
    if (!await validateInviteCode(inviteCode)) {
        logToReadme(`[${timelog()}] 🚨 Invite code ${inviteCode} is invalid.`);
        return;
    }
    
    try {
        const response = await axios.post(`${BASE_URL}/referral/register-wallet/${inviteCode}`, { walletAddress }, { headers: HEADERS });
        logToReadme(`[${timelog()}] ✅ Wallet ${walletAddress} registered successfully.`);
        return response.data;
    } catch (error) {
        logToReadme(`[${timelog()}] Failed to register wallet: ${walletAddress}, ${error.response?.data || error.message}`);
    }
}

async function claimPoints(walletAddress, privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    const timestamp = Date.now();
    const message = `I am claiming my daily node point for ${walletAddress} at ${timestamp}`;
    const sign = await wallet.signMessage(message);
    
    try {
        const response = await axios.post(`${BASE_URL}/light-node/claim-node-points`, { walletAddress, timestamp, sign }, { headers: HEADERS });
        logToReadme(`[${timelog()}] ✅ Points claimed for ${walletAddress}`);
        return response.data;
    } catch (error) {
        logToReadme(`[${timelog()}] 🚨 Failed to claim points for ${walletAddress}: ${error.response?.data || error.message}`);
    }
}

async function startNode(walletAddress, privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    const timestamp = Date.now();
    const message = `Node activation request for ${walletAddress} at ${timestamp}`;
    const sign = await wallet.signMessage(message);
    
    try {
        const response = await axios.post(`${BASE_URL}/light-node/node-action/${walletAddress}/start`, { timestamp, sign }, { headers: HEADERS });
        logToReadme(`[${timelog()}] ✅ Node started for ${walletAddress}`);
        return response.data;
    } catch (error) {
        logToReadme(`[${timelog()}] 🚨 Failed to start node for ${walletAddress}: ${error.response?.data || error.message}`);
    }
}

async function processWallet(privateKey, inviteCode) {
    const wallet = new ethers.Wallet(privateKey);
    const walletAddress = wallet.address;
    let walletData = await checkWallet(walletAddress);

    if (!walletData) {
        logToReadme(`[${timelog()}] 🚨 Wallet ${walletAddress} not registered. Registering now...`);
        await registerWallet(walletAddress, inviteCode);
        walletData = await checkWallet(walletAddress);
    }
    
    if (!walletData) {
        logToReadme(`[${timelog()}] 🚨 Failed execution for ${walletAddress}`);
        return;
    }
    
    const userInfo = walletData.data;
    let lastClaimed = moment().subtract(1, 'year').toDate();
    if (userInfo.lastClaimed) {
        lastClaimed = userInfo.lastClaimed;
    }
    
    logToReadme(`[${timelog()}] Wallet Address: ${userInfo.walletAddress}`);
    logToReadme(`[${timelog()}] Node Points: ${userInfo.nodePoints}`);
    logToReadme(`[${timelog()}] Last Claim Point: ${moment(lastClaimed).format('DD/MM/YYYY HH:mm:ss')}`);
    
    const diffDate = moment(lastClaimed).add(1, 'day').diff(moment().toDate());
    if (diffDate < 0) {
        await claimPoints(walletAddress, privateKey);
        await startNode(walletAddress, privateKey);
    }
}

const main = async () => {
    while (true) {  // 无限循环
        try {
            logToReadme(`[${timelog()}] 🚀 Starting new processing cycle`);
            let wallets = await readWallets();
            let reffCodes = await readReffCodes();
            
            for (let i = 0; i < wallets.length; i++) {
                const randomIndex = Math.floor(Math.random() * reffCodes.length);
                const reffCode = reffCodes[randomIndex];

                console.log(`[${i+1}] Processing ${new ethers.Wallet(wallets[i].privateKey).address}`);

                try {
                    await processWallet(wallets[i].privateKey, reffCode);
                } catch (error) {
                    logToReadme(`[${timelog()}] 🚨 Error processing wallet ${new ethers.Wallet(wallets[i].privateKey).address}: ${error.message}`);
                }
                
                await sleep(1 * 1000);
            }

            logToReadme(`[${timelog()}] ✅ Cycle completed. Waiting 24 hours before next cycle...`);
            await sleep(24 * 60 * 60 * 1000);  // 等待24小时
        } catch (error) {
            logToReadme(`[${timelog()}] 🚨 Cycle error: ${error.message}. Retrying in 24 hours...`);
            await sleep(24 * 60 * 60 * 1000);
        }
    }
};

main();
