# SiteLens - Interview Preparation Guide
## Quick Reference for Common Interview Questions

---

## 🎯 **Elevator Pitch (30 seconds)**

"I built SiteLens, a real-time website monitoring system that tracks uptime, performance metrics, and sends alerts. It's a full-stack Node.js application with MongoDB, featuring JWT authentication, automated monitoring every 20 seconds, email alerts, and a dashboard for visualization. The system handles multiple users, tracks response times, SSL expiry, and generates daily PDF reports."

---

## ❓ **Common Interview Questions & Answers**

### **1. "Tell me about this project"**

**Answer:**
"SiteLens is a website monitoring platform I developed to track website uptime and performance. Users can register, add websites to monitor, and receive real-time statistics through a web dashboard. The system continuously checks websites every 20 seconds, records metrics like response time and status codes, detects downtime, and sends email alerts. It also generates daily PDF reports with performance charts. The architecture uses Node.js/Express for the REST API, MongoDB for data storage, and a vanilla JavaScript frontend. I implemented features like JWT authentication, circuit breakers for resilience, retry logic, and automated data cleanup."

**Key Points to Mention:**
- Full-stack application
- Real-time monitoring
- Multi-user system
- Email alerts and reports
- Performance optimizations

---

### **2. "What was the biggest challenge you faced?"**

**Answer:**
"The biggest challenge was performance optimization of the statistics endpoint. Initially, when users had thousands of monitoring logs, the `/stats` endpoint was loading ALL logs from MongoDB, processing them in memory, which took 10+ seconds. This made the dashboard unusable.

I solved this by:
1. **Adding query limits** - Only fetch the 1000 most recent logs
2. **Database indexing** - Created compound indexes on `{userId, website, timestamp}`
3. **Query optimization** - Used `.lean()` for faster queries without Mongoose overhead
4. **Efficient aggregation** - Optimized the grouping and calculation logic

This reduced load times from 10+ seconds to under 2 seconds, even with large datasets."

**Alternative Challenges:**
- Handling concurrent monitoring requests
- Email service reliability (solved with circuit breakers)
- User data isolation and security

---

### **3. "How did you ensure the system is reliable?"**

**Answer:**
"I implemented several resilience patterns:

1. **Circuit Breakers:** For email and SSL services - if they fail 3-5 times, the circuit opens for 5-10 minutes to prevent cascading failures
2. **Retry Logic:** Exponential backoff for transient network failures (2 retries with 1-2 second delays)
3. **Error Isolation:** One website failure doesn't affect monitoring of other sites
4. **Graceful Shutdown:** Proper cleanup on server restart
5. **Data Cleanup:** Automated retention policies prevent database bloat
6. **Health Checks:** `/health` endpoint for monitoring system status
7. **Error Logging:** Centralized logging with severity levels for debugging"

---

### **4. "How would you scale this system?"**

**Answer:**
"For horizontal scaling, I would:

**Short-term (Phase 1):**
- Add Redis caching layer for frequently accessed stats
- Implement parallel monitoring using `Promise.all()` instead of sequential
- Add database connection pooling
- Use PM2 for process management

**Medium-term (Phase 2):**
- **Separate concerns:** Split API server and monitoring workers into separate processes
- **Message queue:** Use Redis/RabbitMQ for monitoring tasks - workers pull tasks from queue
- **Load balancer:** Nginx/HAProxy in front of multiple API server instances
- **Database:** Add read replicas for stats queries, consider time-series database for logs

**Long-term (Phase 3):**
- **Microservices:** Separate auth service, monitoring service, reporting service
- **Caching:** Redis for stats, CDN for static dashboard files
- **Database sharding:** Partition logs by userId or date ranges
- **Monitoring:** Add APM tools (New Relic, Datadog) for observability
- **Containerization:** Docker + Kubernetes for orchestration"

---

### **5. "What design patterns did you use?"**

**Answer:**
"I implemented several design patterns:

1. **Middleware Pattern:** `authenticateToken` middleware for route protection
2. **Circuit Breaker Pattern:** Prevents cascading failures for external services
3. **Retry Pattern:** Exponential backoff for failed operations
4. **Observer Pattern:** Event-driven monitoring with callbacks
5. **Separation of Concerns:** Clear separation between routes, business logic, and data access
6. **Singleton Pattern:** Single monitoring instance shared across the app
7. **Factory Pattern:** `createEmptyStat()` function for stat object creation"

---

### **6. "How did you handle security?"**

**Answer:**
"Security measures include:

1. **Authentication:** JWT tokens with 7-day expiration, stored in localStorage
2. **Password Security:** bcrypt hashing with 10 salt rounds
3. **Authorization:** All database queries filtered by `userId` - users can only access their own data
4. **Input Validation:** URL validation, email normalization, password length checks
5. **Error Handling:** Generic error messages to users, detailed logs internally (prevents information leakage)
6. **Environment Variables:** Sensitive data (DB credentials, email passwords) in `.env` file, not committed
7. **CORS:** Configured for cross-origin requests
8. **SQL Injection Prevention:** Using Mongoose ODM which parameterizes queries"

---

### **7. "Why MongoDB over SQL?"**

**Answer:**
"I chose MongoDB because:

1. **Flexible Schema:** Monitoring logs have varying fields (some have SSL data, some don't)
2. **JSON-like Documents:** Natural fit for JavaScript/Node.js stack
3. **Horizontal Scaling:** Easier to shard for large datasets
4. **Time-series Data:** Logs are naturally time-ordered documents
5. **Rapid Development:** Faster iteration without schema migrations
6. **Mongoose ODM:** Provides validation and middleware hooks

However, for production at scale, I might consider a hybrid approach - MongoDB for logs, PostgreSQL for relational data like users/sites."

---

### **8. "How does the monitoring system work?"**

**Answer:**
"The monitoring engine runs as a background process:

1. **Scheduler:** Uses `setInterval` to check all sites every 20 seconds (configurable)
2. **Database-driven:** Reads sites from MongoDB `Site` collection (supports dynamic addition/removal)
3. **Health Check:** For each site, performs HTTP GET request with 10-second timeout
4. **Metrics Collection:** Records response time, status code, success/failure
5. **SSL Check:** Periodically checks SSL certificate expiration (with circuit breaker)
6. **Logging:** Saves every check result to MongoDB `Log` collection
7. **Alerting:** If critical failure detected, sends email alert via Nodemailer
8. **Rating:** Classifies each check as 'excellent', 'acceptable', 'concerning', or 'critical'
9. **Daily Reports:** Generates PDF with charts at scheduled time (9:13 PM default)"

---

### **9. "What would you improve if you had more time?"**

**Answer:**
"Several improvements I'd make:

1. **Real-time Updates:** Replace polling with WebSocket connections for live stats
2. **Testing:** Add unit tests (Jest) and integration tests for API endpoints
3. **Performance:** Implement Redis caching for stats, reduce database queries
4. **Monitoring:** Add application performance monitoring (APM)
5. **CI/CD:** Set up automated testing and deployment pipeline
6. **Documentation:** API documentation with Swagger/OpenAPI
7. **Rate Limiting:** Prevent API abuse
8. **Better Error Handling:** More specific error types and recovery strategies
9. **Logging:** Structured logging (Winston/Pino) instead of JSON files
10. **TypeScript:** Add type safety to prevent runtime errors"

---

### **10. "How do you handle concurrent requests?"**

**Answer:**
"Currently, the system handles concurrency through:

1. **Node.js Event Loop:** Non-blocking I/O handles multiple requests concurrently
2. **Async/Await:** All database operations are asynchronous
3. **MongoDB Connection Pooling:** Mongoose manages connection pool automatically
4. **Sequential Monitoring:** Sites are monitored one at a time (could be improved with `Promise.all()`)

For production, I would:
- Use worker threads for CPU-intensive tasks
- Implement parallel monitoring with `Promise.all()` or worker pool
- Add rate limiting to prevent overwhelming monitored sites
- Use message queue for better concurrency control"

---

### **11. "Explain the database schema design"**

**Answer:**
"I designed three main collections:

**Users:** Stores user accounts with hashed passwords
- Indexes on `email` and `username` for fast lookups

**Sites:** Tracks which websites each user monitors
- Compound unique index on `{userId, website}` prevents duplicates
- Allows same website for different users

**Logs:** Time-series data of all monitoring checks
- Compound index on `{userId, website, timestamp}` for efficient queries
- Stores response time, status code, success/failure, SSL data
- Denormalized website URL (reduces joins)

**Design Decisions:**
- User-specific data isolation via `userId` filtering
- Time-series structure for chronological queries
- Denormalization for performance (website URL in logs)
- Indexes optimized for common query patterns"

---

### **12. "What technologies did you use and why?"**

**Answer:**
"**Backend:**
- **Node.js/Express:** Fast, JavaScript ecosystem, great for I/O-heavy tasks
- **MongoDB:** Flexible schema, good for time-series logs
- **JWT:** Stateless authentication, scalable
- **bcryptjs:** Industry-standard password hashing
- **Axios:** HTTP client for monitoring requests
- **Nodemailer:** Email service integration

**Frontend:**
- **Vanilla JavaScript:** No framework overhead, faster load times
- **Chart.js:** Lightweight charting library
- **LocalStorage:** Client-side token storage

**Why these choices:**
- JavaScript across stack (code reuse, team familiarity)
- MongoDB fits flexible log structure
- Vanilla JS keeps bundle size small
- Industry-standard libraries for reliability"

---

### **13. "How do you ensure data consistency?"**

**Answer:**
"Data consistency is maintained through:

1. **MongoDB Transactions:** For critical operations (if needed)
2. **Unique Constraints:** Database-level constraints prevent duplicate sites
3. **User Isolation:** All queries filtered by userId ensures data integrity
4. **Validation:** Mongoose schema validation before saving
5. **Atomic Operations:** MongoDB atomic updates prevent race conditions
6. **Error Handling:** Failed operations are logged and don't corrupt state

For production, I'd add:
- Database transactions for multi-step operations
- Optimistic locking for concurrent updates
- Data validation at API level
- Audit logs for critical operations"

---

### **14. "What metrics do you track?"**

**Answer:**
"The system tracks:

**Availability Metrics:**
- Uptime percentage: (successes / total checks) × 100
- Downtime events: Count and timestamps
- Total downtime duration

**Performance Metrics:**
- Response time: Average, min, max, last
- Slow requests: Count of requests > 2000ms
- Server errors: Count of 5xx status codes
- Status code distribution

**Security Metrics:**
- SSL certificate expiry: Days until expiration

**Historical Data:**
- Latency history: Last 50 data points for charts
- Recent downtimes: Last 5 downtime events
- Status code frequency

These metrics help users understand website health, performance trends, and identify issues."

---

### **15. "How would you test this system?"**

**Answer:**
"I would implement:

**Unit Tests (Jest):**
- Test authentication logic
- Test password hashing/verification
- Test statistics calculation functions
- Test error handling utilities

**Integration Tests:**
- Test API endpoints (supertest)
- Test database operations
- Test monitoring flow end-to-end

**E2E Tests (Playwright/Cypress):**
- Test user registration/login flow
- Test adding/removing sites
- Test dashboard display

**Load Tests (Artillery/k6):**
- Test API under concurrent load
- Test database query performance
- Test monitoring engine with many sites

**Manual Testing:**
- Test email delivery
- Test PDF generation
- Test error scenarios"

---

## 🎤 **Presentation Tips**

1. **Start with the problem:** "I needed a way to monitor multiple websites..."
2. **Show architecture:** Draw simple diagram if possible
3. **Highlight challenges:** Shows problem-solving skills
4. **Mention trade-offs:** Shows critical thinking
5. **Discuss scalability:** Shows forward-thinking
6. **Be honest about limitations:** Shows self-awareness

---

## 📊 **Key Metrics to Mention**

- **Monitoring frequency:** Every 20 seconds
- **Response time improvement:** 10s → 2s (5x faster)
- **Database optimization:** Query limiting + indexing
- **Resilience:** Circuit breakers, retry logic
- **Security:** JWT, bcrypt, user isolation
- **Scalability:** Designed for horizontal scaling

---

## 🎯 **What Makes This Project Stand Out**

1. ✅ **Full-stack development** - Backend + Frontend
2. ✅ **Real-world problem** - Website monitoring is a common need
3. ✅ **Performance optimization** - Solved actual performance issues
4. ✅ **Resilience patterns** - Circuit breakers, retry logic
5. ✅ **Security best practices** - Authentication, authorization, data isolation
6. ✅ **Scalability awareness** - Understands limitations and improvements
7. ✅ **Production considerations** - Error handling, logging, cleanup

---

## 💡 **Pro Tips**

- **Be specific:** Use numbers (20 seconds, 1000 logs, 7 days retention)
- **Show learning:** "I learned about circuit breakers when email service failed..."
- **Discuss trade-offs:** "I chose MongoDB for flexibility, but SQL would be better for..."
- **Be honest:** "This is an MVP, for production I would add..."
- **Show passion:** Explain why you built it, what problems it solves

---

Good luck with your interview! 🚀
