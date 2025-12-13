# 🚀 SiteLens Deployment Guide - Render.com

## Prerequisites Checklist
- [ ] GitHub account (free)
- [ ] MongoDB Atlas account (free)
- [ ] Gmail account (for email alerts)

---

## Step 1: Push Code to GitHub

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
3. Click **"Allow Access from Anywhere"** (for Render deployment)
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
6. Add database name at the end: `?retryWrites=true&w=majority&appName=Cluster0` → change to `?retryWrites=true&w=majority&appName=Cluster0`
   - Actually, add `/sitelens` before the `?`:
   ```
   mongodb+srv://sitelens:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/sitelens?retryWrites=true&w=majority
   ```
7. **Save this connection string** - you'll need it for Render!

---

## Step 3: Deploy on Render

### 3.1 Sign Up
1. Go to [render.com](https://render.com)
2. Click **"Get Started for Free"**
3. Sign up with GitHub (easiest option)

### 3.2 Create New Web Service
1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub account (if not already connected)
3. Find and select your repository: `sitelens-monitor`
4. Click **"Connect"**

### 3.3 Configure Service
Fill in these settings:

- **Name:** `sitelens-monitor` (or any name)
- **Region:** Choose closest to you
- **Branch:** `main`
- **Root Directory:** Leave empty (or `./` if needed)
- **Runtime:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

### 3.4 Set Environment Variables
Click **"Advanced"** → **"Add Environment Variable"** and add:

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

**Note:** For Gmail App Password:
1. Go to Google Account → Security
2. Enable 2-Step Verification
3. Go to App Passwords
4. Generate password for "Mail"
5. Use that password (not your regular Gmail password)

### 3.5 Deploy
1. Click **"Create Web Service"**
2. Wait 5-10 minutes for build to complete
3. You'll see logs - watch for "✅ Server running on..."
4. Your app URL will be: `https://sitelens-monitor.onrender.com` (or similar)

---

## Step 4: Test Your Deployment

### 4.1 Check Health
Visit: `https://your-app-name.onrender.com/health`
Should return JSON with status.

### 4.2 Access Dashboard
Visit: `https://your-app-name.onrender.com/dashboard`
You should see the monitoring dashboard!

### 4.3 Test Adding a Site
1. Enter a URL in the search bar (e.g., `https://google.com`)
2. Press Enter
3. Wait 20-30 seconds
4. The site should appear with metrics!

---

## Step 5: Update Dashboard URL (Optional)

If you want to use a custom domain:
1. Go to Render dashboard → Your service → Settings
2. Scroll to **"Custom Domain"**
3. Add your domain (requires DNS setup)

---

## Troubleshooting

### App won't start
- Check logs in Render dashboard
- Verify all environment variables are set correctly
- Ensure MongoDB connection string is correct

### Can't connect to MongoDB
- Check IP whitelist in MongoDB Atlas (should allow `0.0.0.0/0`)
- Verify password in connection string
- Check database user permissions

### Email not working
- Verify Gmail App Password (not regular password)
- Check EMAIL_USER and EMAIL_PASS are correct
- Check REPORT_EMAIL is valid

### Dashboard shows no sites
- Wait 20-30 seconds after adding a site (monitoring interval)
- Check server logs for errors
- Verify MongoDB connection

---

## Useful Links
- [Render Dashboard](https://dashboard.render.com)
- [MongoDB Atlas Dashboard](https://cloud.mongodb.com)
- [Render Docs](https://render.com/docs)

---

## Cost
- **Render:** Free tier (spins down after 15 min inactivity, wakes on request)
- **MongoDB Atlas:** Free tier (512MB storage)
- **Total:** $0/month for basic usage

---

**🎉 Congratulations! Your SiteLens monitoring app is now live!**

