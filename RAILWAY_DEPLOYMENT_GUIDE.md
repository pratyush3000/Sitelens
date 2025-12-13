# 🚂 SiteLens Deployment Guide - Railway

## Prerequisites Checklist
- [ ] GitHub account (free)
- [ ] MongoDB Atlas account (free)
- [ ] Gmail account (for email alerts)
- [ ] Railway account (free)

---

## Step 1: Push Code to GitHub (If Not Done Already)

### 1.1 Create GitHub Repository
1. Go to [github.com](https://github.com) and sign in
2. Click **"+"** → **"New repository"**
3. Name it: `sitelens-monitor`
4. Choose **Public** (or Private)
5. Click **"Create repository"**

### 1.2 Push Your Code
Open terminal in your project folder (`api_codes`) and run:

```bash
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - SiteLens monitoring app"

# Add your GitHub repo (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/sitelens-monitor.git

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## Step 2: Set Up MongoDB Atlas (Free Cloud Database)

### 2.1 Create Account
1. Go to [mongodb.com/cloud/atlas](https://www.mongodb.com/cloud/atlas)
2. Click **"Try Free"** or **"Sign Up"**
3. Sign up with Google/GitHub or email

### 2.2 Create Free Cluster
1. Choose **"M0 Free"** (Free tier)
2. Select a cloud provider (AWS recommended)
3. Choose a region close to you
4. Click **"Create Cluster"** (takes 3-5 minutes)

### 2.3 Create Database User
1. Go to **"Database Access"** (left sidebar)
2. Click **"Add New Database User"**
3. Choose **"Password"** authentication
4. Username: `sitelens` (or any name)
5. Password: Generate a strong password (save it!)
6. Database User Privileges: **"Atlas admin"**
7. Click **"Add User"**

### 2.4 Whitelist IP Address
1. Go to **"Network Access"** (left sidebar)
2. Click **"Add IP Address"**
3. Click **"Allow Access from Anywhere"** (for Railway deployment)
   - Or add `0.0.0.0/0` manually
4. Click **"Confirm"**

### 2.5 Get Connection String
1. Go to **"Database"** (left sidebar)
2. Click **"Connect"** on your cluster
3. Choose **"Connect your application"**
4. Copy the connection string (looks like):
   ```
   mongodb+srv://sitelens:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
5. Replace `<password>` with your database user password
6. Add database name: Change the `?` part to include database name:
   ```
   mongodb+srv://sitelens:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/sitelens?retryWrites=true&w=majority
   ```
7. **Save this connection string** - you'll need it for Railway!

---

## Step 3: Deploy on Railway

### 3.1 Sign Up
1. Go to [railway.app](https://railway.app)
2. Click **"Start a New Project"** or **"Login"**
3. Sign up with GitHub (easiest option - connects automatically)

### 3.2 Create New Project
1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Choose your repository: `sitelens-monitor`
4. Railway will automatically detect it's a Node.js app

### 3.3 Configure Service
Railway auto-detects Node.js, but verify:

1. Click on your service
2. Go to **"Settings"** tab
3. Check:
   - **Root Directory:** Leave empty (or `./` if needed)
   - **Build Command:** `npm install` (auto-detected)
   - **Start Command:** `npm start` (auto-detected)

### 3.4 Set Environment Variables
1. Go to **"Variables"** tab in your service
2. Click **"New Variable"** and add each:

```
MONGO_URI = mongodb+srv://sitelens:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/sitelens?retryWrites=true&w=majority
```

```
EMAIL_USER = your-email@gmail.com
```

```
EMAIL_PASS = your-gmail-app-password
```

```
REPORT_EMAIL = recipient@example.com
```

```
EMAIL_SERVICE = gmail
```

```
PORT = 3000
```

**Note:** Railway automatically sets `PORT` environment variable, but setting it explicitly won't hurt.

**For Gmail App Password:**
1. Go to Google Account → Security
2. Enable 2-Step Verification
3. Go to App Passwords
4. Generate password for "Mail"
5. Use that password (not your regular Gmail password)

### 3.5 Deploy
1. Railway automatically starts deploying when you connect the repo
2. Watch the **"Deployments"** tab for build progress
3. Wait 3-5 minutes for build to complete
4. You'll see logs - watch for "✅ Server running on..."
5. Your app URL will be shown in the **"Settings"** tab under **"Domains"**

### 3.6 Get Your App URL
1. Go to **"Settings"** tab
2. Scroll to **"Domains"** section
3. Railway provides a default domain like: `sitelens-monitor-production.up.railway.app`
4. Click **"Generate Domain"** if not already generated
5. Copy the URL (e.g., `https://sitelens-monitor-production.up.railway.app`)

---

## Step 4: Test Your Deployment

### 4.1 Check Health
Visit: `https://your-app-name.up.railway.app/health`
Should return JSON with status.

### 4.2 Access Dashboard
Visit: `https://your-app-name.up.railway.app/dashboard`
You should see the monitoring dashboard!

### 4.3 Test Adding a Site
1. Enter a URL in the search bar (e.g., `https://google.com`)
2. Press Enter
3. Wait 20-30 seconds
4. The site should appear with metrics!

---

## Step 5: Custom Domain (Optional)

If you want to use your own domain:
1. Go to **"Settings"** → **"Domains"**
2. Click **"Custom Domain"**
3. Enter your domain (e.g., `monitor.yourdomain.com`)
4. Follow DNS instructions Railway provides
5. Railway handles SSL automatically

---

## Railway vs Render Comparison

| Feature | Railway | Render |
|---------|---------|--------|
| **Free Credit** | $5/month | $0 |
| **Always On** | Yes | No (spins down) |
| **Wake Delay** | None | 30-60 seconds |
| **Best For** | 24/7 monitoring | Low traffic apps |
| **Monthly Cost** | ~$2-3 after credit | Free |

---

## Troubleshooting

### App won't start
- Check **"Deployments"** tab → **"View Logs"**
- Verify all environment variables are set correctly
- Ensure MongoDB connection string is correct
- Check that `package.json` has `"start": "node server.js"`

### Can't connect to MongoDB
- Check IP whitelist in MongoDB Atlas (should allow `0.0.0.0/0`)
- Verify password in connection string
- Check database user permissions
- Ensure database name is in connection string (`/sitelens`)

### Email not working
- Verify Gmail App Password (not regular password)
- Check EMAIL_USER and EMAIL_PASS are correct
- Check REPORT_EMAIL is valid
- Ensure EMAIL_SERVICE is set to `gmail`

### Dashboard shows no sites
- Wait 20-30 seconds after adding a site (monitoring interval)
- Check deployment logs for errors
- Verify MongoDB connection
- Check that monitoring is running (look for logs in Railway)

### Build fails
- Check that all dependencies are in `package.json`
- Verify Node.js version (Railway auto-detects)
- Check build logs for specific errors

---

## Cost Management

### Monitor Usage
1. Go to Railway dashboard
2. Click on your project
3. View **"Usage"** tab to see current spending
4. Set spending limits in **"Settings"** → **"Usage"**

### Stay Within Free Credit
- Your app uses ~$0.01/hour = ~$7.20/month if running 24/7
- With $5 free credit, you pay ~$2.20/month
- To reduce costs:
  - Monitor fewer sites
  - Increase monitoring interval (in config)
  - Use Render for free (but with wake delays)

---

## Useful Links
- [Railway Dashboard](https://railway.app/dashboard)
- [Railway Docs](https://docs.railway.app)
- [MongoDB Atlas Dashboard](https://cloud.mongodb.com)

---

## Quick Reference

**Railway App URL:** `https://your-app-name.up.railway.app`

**Dashboard:** `https://your-app-name.up.railway.app/dashboard`

**Health Check:** `https://your-app-name.up.railway.app/health`

**Stats API:** `https://your-app-name.up.railway.app/stats`

---

**🎉 Congratulations! Your SiteLens monitoring app is now live on Railway with 24/7 monitoring!**

