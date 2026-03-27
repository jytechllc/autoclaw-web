// WeChat Pay Native API Implementation (without SDK)
// https://pay.weixin.qq.com/wiki/doc/apiv3/index.shtml

import crypto from "crypto";

export interface WechatPayConfig {
  mchid: string;
  appid: string;
  certSerial: string;
  apiV3Key: string;
  privateKey: string;
  notifyUrl: string;
}

export function getWechatPayConfig(): WechatPayConfig {
  let rawPrivateKey = process.env.WECHAT_PAY_PRIVATE_KEY!;
  
  console.log('Raw private key (first 100 chars):', rawPrivateKey.substring(0, 100));
  
  // Handle multi-line private key in .env file
  // If the key contains actual newlines (not \n), join them with \n
  if (rawPrivateKey.includes('\n') && !rawPrivateKey.includes('\\n')) {
    rawPrivateKey = rawPrivateKey.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n');
  }
  
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n');
  console.log('After replace (first 100 chars):', privateKey.substring(0, 100));
  
  const config = {
    mchid: process.env.WECHAT_PAY_MCHID!,
    appid: process.env.WECHAT_PAY_APPID!,
    certSerial: process.env.WECHAT_PAY_CERT_SERIAL!,
    apiV3Key: process.env.WECHAT_PAY_APIV3_KEY!,
    privateKey,
    notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL!,
  };

  const missing = Object.entries(config)
    .filter(([, v]) => !v || v.includes('your_'))
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new Error(`Missing WeChat Pay config: ${missing.join(", ")}`);
  }

  // Validate private key format
  console.log('Checking private key format...');
  console.log('Has BEGIN marker:', privateKey.includes('-----BEGIN'));
  console.log('Has END marker:', privateKey.includes('END PRIVATE KEY-----'));
  console.log('Private key last 100 chars:', privateKey.slice(-100));
  
  // Check for private key markers - be flexible with number of dashes
  const hasBegin = /-----BEGIN PRIVATE KEY-----/.test(privateKey);
  const hasEnd = /-----END PRIVATE KEY-----/.test(privateKey) || /------END PRIVATE KEY-----/.test(privateKey);
  
  if (!hasBegin || !hasEnd) {
    throw new Error('Invalid private key format. Must include BEGIN and END markers.');
  }

  console.log('Private key length:', privateKey.length);
  console.log('Private key starts with:', privateKey.substring(0, 50));

  return config;
}

// Generate authorization signature for API requests
function generateSignature(
  method: string,
  url: string,
  timestamp: string,
  nonceStr: string,
  body: string,
  privateKey: string
): string {
  const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
  
  try {
    const sign = crypto.createSign("RSA-SHA256");
    sign.update(message);
    return sign.sign(privateKey, "base64");
  } catch (error) {
    console.error('Signature generation error:', error);
    throw new Error(`Failed to generate signature: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Generate random nonce string
function generateNonceStr(length = 32): string {
  return crypto.randomBytes(length).toString("hex").slice(0, length);
}

// WeChat Pay API base URL
const WECHAT_PAY_BASE_URL = "https://api.mch.weixin.qq.com";

// Make authenticated request to WeChat Pay API
export async function wechatPayRequest(
  method: string,
  path: string,
  body?: object
): Promise<any> {
  const config = getWechatPayConfig();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = generateNonceStr();
  const bodyStr = body ? JSON.stringify(body) : "";

  const signature = generateSignature(
    method,
    path,
    timestamp,
    nonceStr,
    bodyStr,
    config.privateKey
  );

  const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${config.mchid}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${config.certSerial}"`;

  const response = await fetch(`${WECHAT_PAY_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: authorization,
    },
    body: bodyStr || undefined,
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`WeChat Pay API error: ${JSON.stringify(error)}`);
  }

  return response.json();
}

// Create Native payment order (QR code)
export async function createNativeOrder(params: {
  description: string;
  outTradeNo: string;
  notifyUrl: string;
  amount: { total: number; currency: string };
  attach?: string;
}): Promise<{ code_url: string }> {
  const config = getWechatPayConfig();

  const body = {
    appid: config.appid,
    mchid: config.mchid,
    description: params.description,
    out_trade_no: params.outTradeNo,
    notify_url: params.notifyUrl,
    amount: params.amount,
    attach: params.attach,
  };

  return wechatPayRequest("POST", "/v3/pay/transactions/native", body);
}

// Query order status
export async function queryOrder(outTradeNo: string): Promise<{
  trade_state: string;
  transaction_id?: string;
  success_time?: string;
  amount?: { total: number };
}> {
  const config = getWechatPayConfig();
  const path = `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${config.mchid}`;
  return wechatPayRequest("GET", path);
}

// Verify webhook signature
export function verifyWebhookSignature(
  timestamp: string,
  nonce: string,
  body: string,
  signature: string,
  apiKey: string
): boolean {
  const message = `${timestamp}\n${nonce}\n${body}\n`;
  const expectedSign = crypto
    .createHmac("sha256", apiKey)
    .update(message)
    .digest("base64");
  return signature === expectedSign;
}

// Decrypt webhook notification (AES-GCM)
export function decryptWebhook(
  ciphertext: string,
  associatedData: string,
  nonce: string,
  apiKey: string
): string {
  // Decode base64
  const cipherBuffer = Buffer.from(ciphertext, "base64");
  const key = crypto.createHash("sha256").update(apiKey).digest();

  // Extract auth tag (last 16 bytes for GCM)
  const authTag = cipherBuffer.slice(-16);
  const encryptedData = cipherBuffer.slice(0, -16);

  const decipher = crypto.createDecipherGCM("aes-256-gcm", key);
  decipher.setAAD(Buffer.from(associatedData));
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, undefined, "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// Plan pricing configuration
export function getWechatPayPlans(): Record<
  string,
  { name: string; amount: number; description: string }
> {
  return {
    growth: {
      name: "Growth",
      amount: 69900, // 699.00 CNY in cents
      description: "Growth Plan - Monthly Subscription",
    },
    scale: {
      name: "Scale",
      amount: 278800, // 2788.00 CNY in cents
      description: "Scale Plan - Monthly Subscription",
    },
  };
}

// Generate unique order number
export function generateOrderNo(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `WX${timestamp}${random}`;
}
