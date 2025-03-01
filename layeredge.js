import { ethers } from 'ethers';
import fs from 'fs';
import axios from 'axios';
import moment from 'moment';
import momentlog from 'moment-timezone'
 
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

const PROXY_FILE = 'proxies.txt';

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

// Proxy Management
function loadProxies() {
    try {
        const content = fs.readFileSync(PROXY_FILE, 'utf8');
        return content.split('\n')
            .map(line => line.trim())
            .filter(line => line && line.length > 0);
    } catch (error) {
        console.error('Error loading proxies:', error.message);
        return [];
    }
}

function getRandomProxy(proxies) {
    if (!proxies.length) return null;
    return proxies[Math.floor(Math.random() * proxies.length)];
}

function createProxyAgent(proxy) {
    if (!proxy) return null;
    
    const [auth, hostPort] = proxy.includes('@') ? proxy.split('@') : [null, proxy];
    const [host, port] = hostPort ? hostPort.split(':') : proxy.split(':');
    
    const proxyOptions = {
        host,
        port: parseInt(port),
        ...(auth && {
            auth: auth.includes(':') ? auth : `${auth}:`
        })
    };

    if (proxy.startsWith('socks4://') || proxy.startsWith('socks5://')) {
        const proxyType = proxy.startsWith('socks5') ? 'SOCKS5' : 'SOCKS4';
        console.log(`Proxy ${proxyType} dari proxies.txt digunakan: ${proxy}`);
        return new SocksProxyAgent(`socks${proxy.startsWith('socks5') ? 5 : 4}://${proxy.replace(/^socks[4-5]:\/\//, '')}`);
    }
    console.log(`Proxy HTTP dari proxies.txt digunakan: ${proxy}`);
    return new HttpsProxyAgent(`${proxy}`);
}

async function request(url, options = {}, retries = 3) {
    const proxies = loadProxies();
    let proxy = getRandomProxy(proxies);
    let attempt = 0;

    while (attempt < retries) {
        const agent = proxy ? createProxyAgent(proxy) : null;
        if (!proxy) {
            console.log('Without use proxy.');
        }

        try {
            const response = await axios({
                url,
                ...options,
                timeout: 10000, // Set timeout to 10 seconds
                ...(agent && { httpsAgent: agent, httpAgent: agent })
            });
            return response;
        } catch (error) {
            attempt++;
            if (error.code === 'EAI_AGAIN') {
                console.error(`Kesalahan EAI_AGAIN pada percobaan ${attempt}/${retries} dengan proxy: ${proxy || 'tanpa proxy'}`);
                if (attempt < retries) {
                    console.log('Mencoba lagi dengan proxy lain...');
                    proxy = getRandomProxy(proxies); // Ganti proxy untuk percobaan berikutnya
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Tunggu 2 detik sebelum retry
                    continue;
                }
            }
            throw new Error(`Request failed setelah ${retries} percobaan${proxy ? ' dengan proxy ' + proxy : ''}: ${error.message}`);
        }
    }
}

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
        //const response = await axios.get(`${BASE_URL}/referral/wallet-details/${walletAddress}`, { headers: HEADERS });

        const response = await request(`${BASE_URL}/referral/wallet-details/${walletAddress}`, {
            method: 'GET',
            headers: HEADERS,
        });

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
        //const response = await axios.post(`${BASE_URL}/referral/verify-referral-code`, { invite_code: inviteCode }, { headers: HEADERS });
        
        const response = await request(`${BASE_URL}/referral/verify-referral-code`, {
            method: 'POST',
            data: { invite_code: inviteCode },
            headers: HEADERS,
        });

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
        //const response = await axios.post(`${BASE_URL}/referral/register-wallet/${inviteCode}`, { walletAddress }, { headers: HEADERS });

        const response = await request(`${BASE_URL}/referral/register-wallet/${inviteCode}`, {
            method: 'POST',
            data: { walletAddress },
            headers: HEADERS,
        });

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
        //const response = await axios.post(`${BASE_URL}/light-node/claim-node-points`, { walletAddress, timestamp, sign }, { headers: HEADERS });

        const response = await request(`${BASE_URL}/light-node/claim-node-points`, {
            method: 'POST',
            data: { walletAddress, timestamp, sign },
            headers: HEADERS,
        });

        logToReadme(`[${timelog()}] ✅ Points claimed for ${walletAddress}`);
        return response.data;
    } catch (error) {
        logToReadme(`[${timelog()}] 🚨 Failed to claim points for ${walletAddress}: ${error.response?.data || error.message}`);
    }
}

async function runBrowserLightNodeTask(walletAddress, privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    const timestamp = Date.now();
    const message = `I am claiming Run a Browser-Based Light Node Points for ${walletAddress} at ${timestamp}`;
    const sign = await wallet.signMessage(message);
    
    try {
        //const response = await axios.post(`${BASE_URL}/light-node/claim-node-points`, { walletAddress, timestamp, sign }, { headers: HEADERS });

        const response = await request(`${BASE_URL}/task/node-points`, {
            method: 'POST',
            data: { walletAddress, timestamp, sign },
            headers: HEADERS,
        });

        logToReadme(`[${timelog()}] ✅ Points claimed for ${walletAddress}`);
        return response.data;
    } catch (error) {
        logToReadme(`[${timelog()}] 🚨 Failed to claim points for ${walletAddress}: ${error.response?.data || error.message}`);
    }
}

async function sendProof(walletAddress, privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    const timestamp = Date.now();
    const message = `I am submitting a proof for LayerEdge at ${timestamp}`;
    const sign = await wallet.signMessage(message);
    const proof = "Grow your EDGE points by completing tasks like submitting and verifying proofs, pledging and more. Points accumulated from completing the tasks are added to your node points balance."
    
    try {
        //const response = await axios.post(`${BASE_URL}/light-node/claim-node-points`, { walletAddress, timestamp, sign }, { headers: HEADERS });

        const response = await request(`https://dashboard.layeredge.io/api/send-proof`, {
            method: 'POST',
            data: { "address":walletAddress, proof, sign },
            headers: HEADERS,
        });

        logToReadme(`[${timelog()}] ✅ Send Proof for ${walletAddress}`);
        return response.data;
    } catch (error) {
        logToReadme(`[${timelog()}] 🚨 Send Proof for ${walletAddress}: ${error.response?.data || error.message}`);
    }
}

async function proofSubmissionTask(walletAddress, privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    const timestamp = Date.now();
    const message = `Submit a proof task for LayerEdge at ${timestamp}`;
    const sign = await wallet.signMessage(message);
    
    try {
        //const response = await axios.post(`${BASE_URL}/light-node/claim-node-points`, { walletAddress, timestamp, sign }, { headers: HEADERS });

        const response = await request(`${BASE_URL}/task/proof-submission`, {
            method: 'POST',
            data: { walletAddress, timestamp, sign },
            headers: HEADERS,
        });

        logToReadme(`[${timelog()}] ✅ Submit a proof task for ${walletAddress}`);
        return response.data;
    } catch (error) {
        logToReadme(`[${timelog()}] 🚨 Submit a proof task for ${walletAddress}: ${error.response?.data || error.message}`);
    }
}

async function startNode(walletAddress, privateKey) {
    const wallet = new ethers.Wallet(privateKey);
    const timestamp = Date.now();
    const message = `Node activation request for ${walletAddress} at ${timestamp}`;
    const sign = await wallet.signMessage(message);
    
    try {
        //const response = await axios.post(`${BASE_URL}/light-node/node-action/${walletAddress}/start`, { timestamp, sign }, { headers: HEADERS });

        const response = await request(`${BASE_URL}/light-node/node-action/${walletAddress}/start`, {
            method: 'POST',
            data: { timestamp, sign },
            headers: HEADERS,
        });

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

        await runBrowserLightNodeTask(walletAddress, privateKey);
        await sendProof(walletAddress, privateKey);
        await proofSubmissionTask(walletAddress, privateKey);
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
