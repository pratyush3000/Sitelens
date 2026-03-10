# 🔎 SiteLens

> **A modern, full-stack website monitoring dashboard that goes beyond uptime — tracking infrastructure health, performance metrics, and AI search visibility all in one place.**

SiteLens continuously monitors your websites every 20 seconds and alerts you the moment something goes wrong. From DNS resolution times to SSL certificate expiry to whether your brand appears in AI-generated recommendations — SiteLens gives you the full picture, not just a green or red dot.

---

## 🚀 What Makes SiteLens Different

Most uptime monitors just tell you if your site is up or down. SiteLens tells you:
- **Why** your site is slow
- **When** it went down and for how long
- **Whether AI recommends your brand** when users search for your product or service

No other tool combines infrastructure monitoring with AI search visibility tracking.

---

## ✅ Features

### 🟢 Uptime Monitoring
- Checks your websites every 20 seconds
- Smart **HEAD → GET fallback** — tries a lightweight HEAD request first, falls back to GET if needed
- Hard **10 second timeout cap** — no more 30 second waits for dead servers
- Instant **email alert** the moment a site goes down
- Automatic recovery detection — notified when a site comes back up

### ⚡ Intelligent Error Classification
Unlike basic monitors that treat every failure the same, SiteLens classifies errors properly:
| Error Type | Meaning | Counted As |
|------------|---------|------------|
| `blocked` | Site returned 403/401 — rejecting your monitor | ✅ Up (uptime not penalised) |
| `timeout` | No response within 10 seconds | ⚠️ Warning |
| `server_error` | Site returned 5xx response | 🔴 Down |
| `down` | DNS failure, connection refused | 🔴 Down |

### 📊 Performance Metrics
- **Response time** — last, average, minimum, maximum per site
- **DNS resolution time** — how long domain lookups take
- **SSL certificate expiry** — days remaining with visual warning badge
- **Slow request detection** — flags requests over your threshold
- **Server error tracking** — counts 5xx responses separately from downtime
- **Status code breakdown** — see your 2xx, 3xx, 4xx, 5xx distribution

### 📈 Visual Dashboard
- Clean card-based layout — one card per monitored site
- **Response time trend charts** — Chart.js line graphs showing latency history
- **Color-coded status badges** — excellent / acceptable / concerning / critical
- **Site detail drawer** — click any card for deep metrics and trend chart
- **Overview stats** — total sites, average uptime %, average latency, slow request count
- Auto-refresh every 5 seconds

### 🤖 AI Search Visibility *(unique feature)*
Track whether your brand appears when AI assistants answer product or service queries.

- Enter your **brand name** and a **keyword** (e.g. "best streaming service")
- SiteLens asks Google Gemini: *"What are the best best streaming service options right now?"*
- Instantly shows **✅ VISIBLE** or **❌ HIDDEN**
- Displays the exact sentence where your brand was mentioned
- Full AI response available for inspection

> This is the equivalent of checking your "AI SEO" — as users shift from Google search to AI assistants for recommendations, knowing whether AI recommends your brand is becoming as important as traditional search rankings.

### 📧 Alerts & Reports
- **Instant email alerts** — fires immediately when a site goes down
- **Daily PDF reports** — automated performance summary emailed every day
- **Latency charts** in PDF reports — visual bar charts of average response times
- Configurable report time via environment variables

### 🔐 Authentication & Multi-User
- JWT-based authentication
- Full **sign up / login** flow
- **Per-user data isolation** — each user only sees their own monitored sites and logs
- Secure password hashing

### 🧹 Automatic Data Cleanup
- Configurable data retention (default: 7 days)
- Auto-cleanup runs every hour
- Keeps your database lean and queries fast

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js (ESM), Express.js |
| Database | MongoDB, Mongoose |
| Frontend | Vanilla HTML, CSS, JavaScript |
| Charts | Chart.js |
| AI | Google Gemini API (gemini-2.5-flash) |
| Email | Nodemailer |
| PDF Generation | PDFKit |
| SSL Checking | ssl-checker |
| HTTP Requests | axios |

---

## 📁 Project Structure

```
sitelens/
├── server.js              # Express server, all API routes
├── monitor.js             # Core monitoring logic, scheduler
├── config.js              # Configuration & performance thresholds
├── db.js                  # MongoDB connection
├── models/
│   ├── User.js            # User schema
│   ├── Site.js            # Monitored sites schema
│   ├── Log.js             # Check logs schema
│   └── DailyStat.js       # Daily statistics schema
├── utils/
│   ├── auth.js            # JWT helpers
│   ├── errorHandler.js    # Error logging, circuit breakers
│   └── dataCleanup.js     # Automatic log cleanup
├── dashboard/
│   ├── index.html         # Main dashboard UI
│   ├── script.js          # Frontend JavaScript
│   └── style.css          # Styles
└── .env                   # Environment variables
```

---

## ⚙️ Setup & Installation

### Prerequisites
- Node.js v18+
- MongoDB (local or Atlas)
- Gmail account (for email alerts)
- Google Gemini API key (free at [aistudio.google.com](https://aistudio.google.com))

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/sitelens.git
cd sitelens
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Copy `.env.example` to `.env` and fill in your values:
```env
# MongoDB
MONGODB_URI=mongodb+srv://your_connection_string

# Email (Gmail)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
REPORT_EMAIL=where_to_send_reports@gmail.com
EMAIL_SERVICE=gmail

# Gemini AI
GEMINI_API_KEY=AIzaYourKeyHere

# Monitoring config (optional)
MONITOR_INTERVAL=20000
REQUEST_TIMEOUT=10000
SLOW_THRESHOLD=2000
DATA_RETENTION_DAYS=7
PORT=3000
```

### 4. Start the server
```bash
node server.js
```

### 5. Open the dashboard
Visit `http://localhost:3000` in your browser, sign up and start monitoring!

---

## 🔌 API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/signup` | ❌ | Create account |
| POST | `/api/auth/login` | ❌ | Login |
| GET | `/api/auth/me` | ✅ | Get current user |
| GET | `/stats` | ✅ | Get all site stats |
| POST | `/api/add-site` | ✅ | Start monitoring a site |
| POST | `/api/remove-site` | ✅ | Stop monitoring a site |
| POST | `/api/ai-visibility` | ✅ | Check AI search visibility |
| GET | `/health` | ❌ | Server health check |

---

## 📊 Performance Thresholds

| Rating | Response Time | Meaning |
|--------|-------------|---------|
| 🟢 Excellent | < 800ms | Fast, healthy |
| 🟡 Acceptable | < 2000ms | Slightly slow |
| 🟠 Concerning | < 5000ms | Slow, needs attention |
| 🔴 Critical | 5xx error | Server broken |

---

## 🗺️ Roadmap

- [ ] AI visibility history & trend charts
- [ ] Brand rank position detection (was it #1 or #5?)
- [ ] Multiple prompt variations per keyword
- [ ] Competitor brand tracking
- [ ] Incident timeline UI
- [ ] Public status pages
- [ ] Slack / webhook alerts
- [ ] Multi-location monitoring

---

## 📄 License

MIT License — free to use, modify and distribute.

---

<p align="center">Built with ❤️ — SiteLens</p>
