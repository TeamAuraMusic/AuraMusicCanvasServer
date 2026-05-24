import axios from "axios";
import * as OTPAuth from "otpauth";
import dotenv from "dotenv";

dotenv.config();

const SP_DC = process.env.SP_DC;

// Latest known working secrets (as of May 2026)
// Update this block when Spotify rotates again
const LATEST_SECRETS = {
  "61": [44,55,47,42,70,40,34,114,76,74,50,111,120,97,75,76,94,102,43,69,49,120,118,80,64,78]
};

let currentTotp = null;
let currentTotpVersion = null;

function createTotpSecret(data) {
  const mappedData = data.map((value, index) => value ^ ((index % 33) + 9));
  const hexData = Buffer.from(mappedData.join(""), "utf8").toString("hex");
  return OTPAuth.Secret.fromHex(hexData);
}

function initializeTOTP() {
  // Use the latest hardcoded secret as primary (more reliable than GitHub fetch)
  const version = "61";
  const secretData = LATEST_SECRETS[version];
  
  if (!secretData) {
    throw new Error("No TOTP secret available");
  }

  const totpSecret = createTotpSecret(secretData);
  currentTotp = new OTPAuth.TOTP({
    period: 30,
    digits: 6,
    algorithm: "SHA1",
    secret: totpSecret
  });
  currentTotpVersion = version;
  
  console.log(`[TOTP] Initialized with version ${version}`);
}

export async function getToken(reason = "init", productType = "mobile-web-player") {
  // Ensure we have a TOTP instance
  if (!currentTotp) {
    initializeTOTP();
  }

  const localTime = Date.now();
  const serverTime = await getServerTime();

  const payload = {
    reason,
    productType,
    totp: currentTotp.generate({ timestamp: localTime }),
    totpVer: currentTotpVersion,
    totpServer: currentTotp.generate({ timestamp: Math.floor(serverTime / 30) })
  };

  const url = new URL("https://open.spotify.com/api/token");
  Object.entries(payload).forEach(([key, value]) => url.searchParams.append(key, value));

  const response = await axios.get(url.toString(), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': 'https://open.spotify.com/',
      'Referer': 'https://open.spotify.com/',
      'Cookie': `sp_dc=${SP_DC}`,
    },
  });

  return response.data?.accessToken;
}

async function getServerTime() {
  try {
    const { data } = await axios.get("https://open.spotify.com/api/server-time", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://open.spotify.com/',
        'Referer': 'https://open.spotify.com/',
        'Cookie': `sp_dc=${SP_DC}`,
      },
    });
    const time = Number(data.serverTime);
    if (isNaN(time)) throw new Error("Invalid server time");
    return time * 1000;
  } catch {
    return Date.now();
  }
}

function generateTOTP(timestamp) {
  if (!currentTotp) {
    throw new Error("TOTP not initialized");
  }
  return currentTotp.generate({ timestamp });
}

function userAgent() {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
}

export { initializeTOTP };
