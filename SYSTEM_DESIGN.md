# SiteLens - Website Monitoring System
## System Design & Architecture Documentation

---

## 📋 **Project Overview**

**SiteLens** is a real-time website monitoring and uptime tracking system that allows users to monitor multiple websites, track their performance metrics, receive alerts, and generate reports.

**Key Features:**
- Multi-user authentication system
- Real-time website health monitoring
- Performance metrics tracking (response time, uptime, SSL expiry)
- Email alerts for downtime
- Daily PDF reports with charts
- Web dashboard for visualization
- Data cleanup and retention policies

---

## 🏗️ **System Architecture**

### **High-Level Architecture**

```
┌─────────────────┐
│   Web Browser   │
│   (Dashboard)   │
└────────┬────────┘
         │ HTTP/REST API
         │
┌────────▼─────────────────────────────────────┐
│         Express.js Server (server.js)         │
│  ┌──────────────────────────────────────────┐ │
│  │  API Routes:                            │ │
│  │  - /api/auth/* (Signup/Login/Me)        │ │
│  │  - /api/add-site, /api/remove-site     │ │
│  │  - /stats (Aggregated metrics)          │ │
│  │  - /health, /cleanup-stats              │ │
│  └──────────────────────────────────────────┘ │
└────────┬──────────────────────────────────────┘
         │
    ┌────┴────┬──────────────────┬──────────────┐
    │         │                  │              │
┌───▼───┐ ┌──▼──────┐    ┌───────▼──────┐  ┌────▼─────┐
│MongoDB│ │ Monitor │    │   Email     │  │  File    │
│       │ │ Engine  │    │   Service   │  │  System  │
│Users  │ │(monitor │    │ (Nodemailer)│  │ (PDFs,   │
│Sites  │ │  .js)   │    │             │  │  Charts) │
│Logs   │ │         │    │             │  │          │
└───────┘ └─────────┘    └────────────┘  └──────────┘
```

---

## 🔧 **Component Breakdown**

### **1. Backend Server (`server.js`)**
**Role:** RESTful API server handling HTTP requests

**Responsibilities:**
- User authentication (JWT-based)
- Site management (add/remove monitoring)
- Statistics aggregation and serving
- Health checks
- Data cleanup orchestration

**Key Endpoints:**
- `POST /api/auth/signup` - User registration
- `POST /api/auth/login` - User authentication
- `GET /api/auth/me` - Get current user (token validation)
- `POST /api/add-site` - Add website to monitor
- `POST /api/remove-site` - Remove website from monitoring
- `GET /stats` - Get aggregated statistics (user-specific)
- `GET /health` - System health check
- `GET /cleanup-stats` - Data cleanup statistics

**Design Patterns:**
- **Middleware Pattern:** `authenticateToken` for route protection
- **Error Handling:** Centralized error logging with severity levels
- **Separation of Concerns:** Routes, business logic, and data access separated

---

### **2. Monitoring Engine (`monitor.js`)**
**Role:** Background service that continuously monitors websites

**Responsibilities:**
- Periodic health checks (every 20 seconds by default)
- HTTP request monitoring (response time, status codes)
- SSL certificate expiration checking
- Downtime detection and alerting
- Logging all monitoring events to MongoDB
- Daily report generation (PDF + charts)

**Key Functions:**
- `monitorWebsite(site, userId)` - Performs health check on a single site
- `monitorAllWebsites()` - Iterates through all sites in database
- `addNewWebsite(url, userId)` - Adds site and starts monitoring
- `removeWebsite(url, userId)` - Stops monitoring and removes data
- `sendDailyReport()` - Generates and emails daily summary

**Design Patterns:**
- **Circuit Breaker Pattern:** Prevents cascading failures for email/SSL services
- **Retry Pattern:** Exponential backoff for failed requests
- **Observer Pattern:** Event-driven monitoring with callbacks
- **Singleton Pattern:** Single monitoring instance shared across app

**Resilience Features:**
- Circuit breakers for email (3 failures → 5min timeout) and SSL (5 failures → 10min timeout)
- Retry logic with exponential backoff (2 retries, 1-2 second delays)
- Graceful shutdown handling
- Error isolation (one site failure doesn't affect others)

---

### **3. Database Layer (MongoDB)**

**Schema Design:**

#### **User Collection**
```javascript
{
  _id: ObjectId,
  username: String (unique, 3-30 chars),
  email: String (unique, lowercase),
  password: String (bcrypt hashed),
  createdAt: Date
}
```

#### **Site Collection**
```javascript
{
  _id: ObjectId,
  website: String (URL),
  userId: ObjectId (ref: User),
  addedAt: Date
}
// Compound index: { userId: 1, website: 1 } (unique)
```

#### **Log Collection**
```javascript
{
  _id: ObjectId,
  website: String,
  userId: ObjectId (ref: User),
  messagetype: String ("up", "down", "warn"),
  success: Boolean,
  statusCode: Number,
  responseTime: Number (ms),
  rating: String ("excellent", "acceptable", "concerning", "critical"),
  sslExpiryDays: Number,
  error: String,
  timestamp: Date
}
// Index: { userId: 1, website: 1, timestamp: -1 }
```

**Database Design Decisions:**
- **User-specific data isolation:** All queries filtered by `userId`
- **Compound indexes** for efficient queries (userId + website + timestamp)
- **Denormalization:** Website URL stored in Logs (reduces joins)
- **Time-series data:** Logs stored chronologically for easy aggregation

---

### **4. Frontend Dashboard (`dashboard/`)**

**Technology Stack:**
- Vanilla JavaScript (no framework)
- Chart.js for visualizations
- Responsive CSS

**Key Features:**
- JWT-based authentication (token stored in localStorage)
- Real-time stats refresh (every 5 seconds)
- Site management (add/remove)
- Overview metrics (total sites, average uptime, latency)
- Individual site cards with detailed metrics
- Drawer for detailed site information

**Architecture:**
- **SPA-like behavior:** Single HTML page with dynamic content
- **RESTful API consumption:** All data fetched via API calls
- **Client-side routing:** Modal-based auth, dashboard view switching
- **Auto-refresh:** Polling mechanism with configurable interval

---

### **5. Utility Modules**

#### **`utils/auth.js`**
- JWT token generation and verification
- Middleware for protected routes
- Token expiration: 7 days

#### **`utils/errorHandler.js`**
- Centralized error logging (JSON file)
- Severity levels: LOW, MEDIUM, HIGH, CRITICAL
- Retry logic with exponential backoff
- Circuit breaker implementation
- Health check functionality

#### **`utils/dataCleanup.js`**
- Automatic data retention (7 days default)
- Scheduled cleanup (every hour)
- Prevents database bloat
- Configurable retention policies

---

## 🔄 **Data Flow**

### **Monitoring Flow:**
```
1. User adds website via dashboard
   ↓
2. POST /api/add-site → Server validates & saves to Site collection
   ↓
3. monitor.js picks up new site from database
   ↓
4. monitorWebsite() performs HTTP GET request
   ↓
5. Response analyzed (status code, response time, SSL check)
   ↓
6. Log entry created in MongoDB
   ↓
7. If critical failure → Email alert sent
   ↓
8. Dashboard polls /stats → Aggregates logs → Displays metrics
```

### **Authentication Flow:**
```
1. User submits credentials
   ↓
2. Server validates against User collection
   ↓
3. JWT token generated (contains userId)
   ↓
4. Token stored in localStorage
   ↓
5. All subsequent requests include: Authorization: Bearer <token>
   ↓
6. authenticateToken middleware validates token
   ↓
7. req.userId extracted for data filtering
```

### **Statistics Aggregation Flow:**
```
1. Dashboard requests GET /stats
   ↓
2. Server queries: Log.find({ userId }).limit(1000).sort({ timestamp: -1 })
   ↓
3. Logs grouped by website
   ↓
4. For each site:
   - Calculate uptime percentage
   - Compute average/min/max response times
   - Count failures, slow requests, server errors
   - Extract SSL expiry days
   - Build latency history
   ↓
5. Return aggregated JSON
   ↓
6. Frontend renders cards and charts
```

---

## 🎯 **Design Patterns & Best Practices**

### **1. Separation of Concerns**
- **server.js:** HTTP layer, routing, request handling
- **monitor.js:** Business logic, monitoring engine
- **models/:** Data models and schemas
- **utils/:** Reusable utilities

### **2. Error Handling Strategy**
- **Centralized logging:** All errors logged to `error_logs.json`
- **Severity levels:** Helps prioritize issues
- **Graceful degradation:** System continues operating despite failures
- **User-friendly messages:** Generic errors to users, detailed logs internally

### **3. Security Measures**
- **Password hashing:** bcrypt with salt rounds (10)
- **JWT tokens:** Stateless authentication
- **User data isolation:** All queries filtered by userId
- **Input validation:** URL validation, password length checks
- **Environment variables:** Sensitive data in .env (not committed)

### **4. Performance Optimizations**
- **Database indexing:** Compound indexes on frequently queried fields
- **Query limiting:** Stats endpoint limits to 1000 recent logs
- **Lean queries:** `.lean()` for faster MongoDB queries (no Mongoose overhead)
- **In-memory caching:** Daily stats cached in `dailyStats` object
- **Efficient aggregation:** Client-side grouping reduces server load

### **5. Scalability Considerations**

**Current Limitations:**
- Single server instance
- Synchronous monitoring (sites checked sequentially)
- In-memory stats (lost on restart)

**Potential Improvements:**
- **Horizontal scaling:** Multiple server instances behind load balancer
- **Message queue:** Use Redis/RabbitMQ for monitoring tasks
- **Worker processes:** Separate monitoring workers from API server
- **Database sharding:** Partition logs by userId or date
- **Caching layer:** Redis for frequently accessed stats
- **CDN:** Serve static dashboard files via CDN

---

## 📊 **Metrics & Monitoring**

**Tracked Metrics:**
- **Uptime percentage:** (successes / total checks) × 100
- **Response time:** Average, min, max, last
- **Failure rate:** Number of failed checks
- **Downtime events:** Count and timestamps
- **Slow requests:** Requests > 2000ms
- **Server errors:** 5xx status codes
- **SSL expiry:** Days until certificate expiration

**Performance Thresholds:**
- **Excellent:** < 300ms response, < 300 status code
- **Acceptable:** < 800ms response, < 400 status code
- **Concerning:** < 1500ms response, < 500 status code
- **Critical:** > 1500ms or 5xx errors

---

## 🔐 **Security Architecture**

1. **Authentication:** JWT tokens (7-day expiration)
2. **Authorization:** User-specific data access (userId filtering)
3. **Password Security:** bcrypt hashing (10 rounds)
4. **Input Sanitization:** URL validation, email normalization
5. **Error Handling:** Generic errors to users, detailed logs internally
6. **CORS:** Configured for cross-origin requests

---

## 🚀 **Deployment Architecture**

**Current Setup:**
- Single Node.js process
- MongoDB Atlas (cloud database)
- Static file serving for dashboard

**Production Considerations:**
- **Process Manager:** PM2 for process management
- **Reverse Proxy:** Nginx for load balancing and SSL termination
- **Monitoring:** Application monitoring (e.g., New Relic, Datadog)
- **Logging:** Centralized logging (e.g., ELK stack)
- **Backup:** Automated MongoDB backups
- **Environment:** Separate dev/staging/production configs

---

## 📈 **Scalability Roadmap**

### **Phase 1: Current (MVP)**
- Single server
- MongoDB Atlas
- Basic monitoring

### **Phase 2: Improved Performance**
- Redis caching layer
- Database query optimization
- Parallel monitoring (Promise.all)

### **Phase 3: Horizontal Scaling**
- Load balancer (Nginx/HAProxy)
- Multiple API server instances
- Separate monitoring workers

### **Phase 4: Advanced Features**
- Real-time WebSocket updates
- Advanced analytics and ML predictions
- Multi-region monitoring
- Custom alert rules

---

## 🎓 **Interview Talking Points**

### **"Tell me about your project"**
"I built SiteLens, a website monitoring system that tracks uptime and performance metrics for multiple websites. It's a full-stack application with a Node.js/Express backend, MongoDB database, and a vanilla JavaScript frontend dashboard. The system continuously monitors websites every 20 seconds, tracks response times, detects downtime, and sends email alerts. Users can view real-time statistics, historical data, and receive daily PDF reports."

### **"What was the biggest challenge?"**
"The biggest challenge was optimizing the statistics endpoint. Initially, it was loading ALL logs from the database, which became slow with thousands of entries. I solved this by implementing query limiting (1000 most recent logs), adding database indexes, and optimizing the aggregation logic. This reduced load times from 10+ seconds to under 2 seconds."

### **"How did you handle reliability?"**
"I implemented several resilience patterns:
1. **Circuit breakers** for email and SSL services to prevent cascading failures
2. **Retry logic** with exponential backoff for transient failures
3. **Graceful error handling** - one site failure doesn't affect others
4. **Data cleanup** to prevent database bloat
5. **Health check endpoints** for monitoring system status"

### **"How would you scale this?"**
"To scale horizontally, I would:
1. **Separate concerns:** Split API server and monitoring workers
2. **Message queue:** Use Redis/RabbitMQ for monitoring tasks
3. **Caching:** Redis for frequently accessed stats
4. **Load balancing:** Multiple API instances behind Nginx
5. **Database:** Shard logs by userId or use time-series database
6. **CDN:** Serve static dashboard files
7. **Monitoring:** Add application performance monitoring"

### **"What design patterns did you use?"**
"I implemented:
- **Middleware pattern** for authentication
- **Circuit breaker pattern** for external services
- **Retry pattern** with exponential backoff
- **Observer pattern** for event-driven monitoring
- **Separation of concerns** across modules"

### **"How did you ensure data security?"**
"Security measures include:
- **JWT authentication** with 7-day token expiration
- **Password hashing** using bcrypt (10 rounds)
- **User data isolation** - all queries filtered by userId
- **Input validation** for URLs and user data
- **Environment variables** for sensitive configuration
- **Error handling** that doesn't leak sensitive information"

---

## 📝 **Key Technical Decisions**

1. **MongoDB over SQL:** Chosen for flexible schema, easy scaling, and JSON-like documents
2. **JWT over sessions:** Stateless authentication, better for scaling
3. **Vanilla JS over React:** Simpler for MVP, faster initial load
4. **Circuit breakers:** Prevents email service failures from affecting monitoring
5. **In-memory stats:** Fast access, but requires persistence strategy for production
6. **Polling over WebSockets:** Simpler implementation, sufficient for MVP

---

## 🎯 **Future Enhancements**

1. **Real-time updates:** WebSocket connections for live stats
2. **Advanced analytics:** Trend analysis, anomaly detection
3. **Multi-region monitoring:** Check sites from different locations
4. **Custom alert rules:** User-defined thresholds and conditions
5. **API rate limiting:** Prevent abuse
6. **GraphQL API:** More flexible data fetching
7. **Mobile app:** React Native dashboard
8. **Team features:** Share sites, role-based access control

---

## 📚 **Technologies Used**

**Backend:**
- Node.js, Express.js
- MongoDB (Mongoose ODM)
- JWT (jsonwebtoken)
- bcryptjs
- Axios
- Nodemailer
- PDFKit
- Chart.js (server-side)

**Frontend:**
- Vanilla JavaScript
- Chart.js
- HTML5/CSS3

**DevOps:**
- dotenv (configuration)
- CORS
- Error logging

---

This system demonstrates:
- ✅ Full-stack development
- ✅ RESTful API design
- ✅ Database design and optimization
- ✅ Real-time monitoring
- ✅ Error handling and resilience
- ✅ Security best practices
- ✅ Performance optimization
- ✅ Scalability considerations
