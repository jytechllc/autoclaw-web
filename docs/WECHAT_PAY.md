# WeChat Pay Integration

This document describes the WeChat Pay integration for AutoClaw.

## Overview

WeChat Pay has been integrated alongside Stripe to provide Chinese users with a convenient payment option. The implementation supports:

- Native Payment (QR code scanning)
- Payment status polling
- Webhook notifications for payment completion
- Order management and tracking

## File Structure

```
lib/
  wechat-pay.ts          # WeChat Pay configuration and utilities
app/
  api/
    wechat-pay/
      route.ts           # Create payment order
      query/
        route.ts         # Query payment status
      notify/
        route.ts         # Webhook handler
  [locale]/
    wechat-pay/
      page.tsx           # Payment page with QR code
```

## Configuration

Add the following environment variables to `.env.local`:

```bash
# WeChat Pay Configuration
WECHAT_PAY_MCHID=your_merchant_id
WECHAT_PAY_APPID=your_app_id
WECHAT_PAY_CERT_SERIAL=your_certificate_serial
WECHAT_PAY_APIV3_KEY=your_apiv3_key
WECHAT_PAY_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nyour_private_key_here\n-----END PRIVATE KEY-----
WECHAT_PAY_NOTIFY_URL=https://your-domain.com/api/wechat-pay/notify
```

### Getting WeChat Pay Credentials

1. **Merchant ID (MCHID)**: Apply at [WeChat Pay Merchant Platform](https://pay.weixin.qq.com/)
2. **App ID**: Create an app at [WeChat Open Platform](https://open.weixin.qq.com/)
3. **Certificate**: Download from Merchant Platform → API Security → API Certificates
4. **APIv3 Key**: Set at Merchant Platform → API Security → APIv3 Key

## Usage

### Creating a Payment

Redirect users to the WeChat Pay page:

```typescript
// Redirect to payment page with plan parameter
window.location.href = "/wechat-pay?plan=growth";
```

Available plans:
- `growth` - ¥99.00/month
- `scale` - ¥299.00/month

### API Endpoints

#### Create Order
```http
POST /api/wechat-pay
Content-Type: application/json

{
  "plan": "growth"
}
```

Response:
```json
{
  "orderNo": "WXKJH123456789",
  "qrCode": "weixin://wxpay/bizpayurl?pr=xxx",
  "amount": 9900,
  "plan": "growth"
}
```

#### Query Status
```http
GET /api/wechat-pay/query?orderNo=WXKJH123456789
```

Response:
```json
{
  "orderNo": "WXKJH123456789",
  "status": "success",
  "tradeState": "SUCCESS",
  "amount": 9900,
  "paidAt": "2024-01-15T10:30:00+08:00",
  "transactionId": "4200001234567890"
}
```

#### Webhook Notification

WeChat Pay sends payment notifications to `/api/wechat-pay/notify`. The endpoint:
- Verifies the signature
- Updates user subscription status
- Records payment in database

## Database Schema

The following columns have been added to support WeChat Pay:

```sql
-- Users table additions
ALTER TABLE users ADD COLUMN wechat_order_no VARCHAR(255);
ALTER TABLE users ADD COLUMN wechat_transaction_id VARCHAR(255);
ALTER TABLE users ADD COLUMN payment_method VARCHAR(50) DEFAULT 'stripe';
ALTER TABLE users ADD COLUMN subscription_status VARCHAR(50) DEFAULT 'inactive';

-- New payments table
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  order_no VARCHAR(255) UNIQUE NOT NULL,
  transaction_id VARCHAR(255),
  payment_method VARCHAR(50),
  amount NUMERIC NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  status VARCHAR(50),
  plan VARCHAR(50),
  paid_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Testing

### Local Development

1. Use [ngrok](https://ngrok.com/) to expose your local server:
   ```bash
   ngrok http 3000
   ```

2. Update `WECHAT_PAY_NOTIFY_URL` with the ngrok URL

3. Use WeChat Pay sandbox credentials for testing

### Test Flow

1. Navigate to `/wechat-pay?plan=growth`
2. Scan QR code with WeChat
3. Complete payment in WeChat
4. Page automatically redirects to success page

## Troubleshooting

### Common Issues

1. **"Missing WeChat Pay config"**
   - Check all environment variables are set
   - Verify private key format (includes newlines)

2. **"Invalid signature" in webhook**
   - Ensure APIv3 key is correct
   - Check certificate serial number matches

3. **QR code not generating**
   - Verify merchant account is activated
   - Check plan configuration exists

### Logs

WeChat Pay operations are logged with prefix `WeChat Pay:`:
```
WeChat Pay error: ...
WeChat Pay webhook error: ...
WeChat Pay success: ...
```

## Security Considerations

1. **Private Key**: Never commit the private key to version control
2. **Webhook Verification**: Always verify webhook signatures
3. **HTTPS**: Required for production webhook URLs
4. **Idempotency**: Orders use unique order numbers to prevent duplicates

## Support

For WeChat Pay API documentation, visit:
- [WeChat Pay API Documentation](https://pay.weixin.qq.com/wiki/doc/apiv3/index.shtml)
- [wechatpay-node-v3 SDK](https://github.com/wechatpay-apiv3/wechatpay-node-v3)
