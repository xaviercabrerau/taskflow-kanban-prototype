# 📋 Environment Variables — Setup Instructions

## 1️⃣ GMAIL_SERVICE_ACCOUNT_JSON

**Source:** Google Cloud Console  
**Steps:**
1. Go to [GCP Console](https://console.cloud.google.com)
2. Select project → **APIs & Services** > **Credentials**
3. **Create Credentials** > **Service Account**
4. Fill: Name `taskflow-notifications`, click "Create"
5. Click the service account
6. **Keys** tab → **Add Key** > **Create new key** > **JSON**
7. JSON file downloads
8. Encode to base64:
   ```bash
   base64 < key.json | tr -d '\n'
   ```
9. Copy base64 string to `GMAIL_SERVICE_ACCOUNT_JSON`

**Verify:**
```bash
echo $GMAIL_SERVICE_ACCOUNT_JSON | base64 -d | jq .type
# Output: "service_account"
```

---

## 2️⃣ GMAIL_SENDER_EMAIL

**Source:** Same GCP service account  
**Value:** `taskflow-notifications@PROJECT_ID.iam.gserviceaccount.com`

---

## 3️⃣ NEXT_PUBLIC_SUPABASE_URL

**Source:** Supabase Dashboard  
**Steps:**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select project → **Settings** > **API**
3. Copy **Project URL** (e.g., `https://xxxxx.supabase.co`)

---

## 4️⃣ SUPABASE_SERVICE_ROLE_KEY

**Source:** Supabase Dashboard  
**Steps:**
1. **Settings** > **API**
2. Under "Project API keys", find **Service Role** (secret)
3. Copy key (long string starting with `eyJ`)

⚠️ **Never commit this!**

---

## 5️⃣ REDIS_URL

**Option A: Vercel KV**
1. Vercel Dashboard → **Storage** > **KV**
2. Create database if needed
3. Copy **REDIS_URL**

**Option B: External Redis**
- Format: `redis://user:password@host:port`

**Verify:**
```bash
redis-cli -u "$REDIS_URL" ping
# Output: PONG
```

---

## 6️⃣ GOOGLE_CLOUD_PROJECT_ID

**Source:** GCP Console  
**Steps:**
1. Top dropdown → Project ID (e.g., `my-project-123`)

---

## 7️⃣ STAFF_API_KEY

**Generate random:**
```bash
openssl rand -base64 32
```

---

## 8️⃣ NEXT_PUBLIC_VERCEL_URL

**Source:** Vercel Dashboard  
**Steps:**
1. **Settings** > **Domains**
2. Production domain (e.g., `https://app.vercel.app`)

---

## 9️⃣-1️⃣1️⃣ Static Values

```
NODE_ENV="production"
LOG_LEVEL="info"
RATE_LIMIT_MAX="5"
```

---

## ✅ Verification Script

```bash
#!/bin/bash
vars=(
  GMAIL_SERVICE_ACCOUNT_JSON GMAIL_SENDER_EMAIL
  NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
  REDIS_URL GOOGLE_CLOUD_PROJECT_ID STAFF_API_KEY
  NEXT_PUBLIC_VERCEL_URL NODE_ENV LOG_LEVEL RATE_LIMIT_MAX
)

for var in "${vars[@]}"; do
  [ -z "$(eval echo \$$var)" ] && echo "❌ $var: NOT SET" || echo "✓ $var: SET"
done
```

**All set?** Move to **PHASE 2: Database Setup** 🚀
