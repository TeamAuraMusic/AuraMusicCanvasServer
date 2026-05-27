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

// Token cache keyed by productType so search vs. canvas can hold separate tokens.
// Tokens are reused until ~60s before Spotify's reported expiry to avoid the
// otherwise-unavoidable ~300ms TOTP round-trip on every Canvas/search hop.
const tokenCache = new Map(); // productType -> { token, expiresAt }

function createTotpSecret(data) {
  const mappedData = data.map((value, index) => value ^ ((index % 33) + 9));
  const hexData = Buffer.from(mappedData.join(""), "utf8").toString("hex");
  return OTPAuth.Secret.fromHex(hexData);
}

function initializeTOTP() {
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
  // Reuse a still-valid cached token if available.
  const cached = tokenCache.get(productType);
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.token;
  }

  if (!currentTotp) initializeTOTP();

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

  const token = response.data?.accessToken;
  const expiresAt = Number(response.data?.accessTokenExpirationTimestampMs) || (Date.now() + 30 * 60_000);
  if (token) tokenCache.set(productType, { token, expiresAt });
  return token;
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

export { initializeTOTP };
