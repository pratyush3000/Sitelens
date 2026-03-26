// script.js - dashboard frontend (expects /stats endpoint)
const REFRESH_INTERVAL = 5000; // ms
let autoRefresh = true;
let timer = null;

const $ = id => document.getElementById(id);

// ================= AUTH HELPERS =================
function getToken() {
  return localStorage.getItem("authToken");
}

function authHeaders() {
  const token = getToken();
  if (!token) {
    alert("Not logged in. Please login again.");
    throw new Error("No auth token");
  }
  return {
    Authorization: `Bearer ${token}`
  };
}

// ================= AUTH UI HANDLERS =================
function showLogin() {
  $("loginForm").classList.remove("hidden");
  $("signupForm").classList.add("hidden");
  $("authTabs").querySelector(".auth-tab.active")?.classList.remove("active");
  document.querySelector('#authTabs button:first-child')?.classList.add("active");
  $("loginError").textContent = "";
  $("signupError").textContent = "";
}

function showSignup() {
  $("signupForm").classList.remove("hidden");
  $("loginForm").classList.add("hidden");
  $("authTabs").querySelector(".auth-tab.active")?.classList.remove("active");
  document.querySelector('#authTabs button:last-child')?.classList.add("active");
  $("loginError").textContent = "";
  $("signupError").textContent = "";
}

async function handleLogin() {
  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;
  $("loginError").textContent = "";
  if (!email || !password) {
    $("loginError").textContent = "Email and password required.";
    return;
  }
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      $("loginError").textContent = data.message || "Login failed.";
      return;
    }
    localStorage.setItem("authToken", data.token);
    if (data.user) {
      $("userInfo").textContent = data.user.username || data.user.email;
    }
    // Hide modal and show dashboard
    const modal = $("authModal");
    const dash = $("dashboard");
    if (modal) {
      modal.style.display = "none";
      modal.classList.add("hidden");
    }
    if (dash) {
      dash.style.display = "block";
      dash.classList.remove("hidden");
    }
    loadStats();
    startTimer();
  } catch (err) {
    $("loginError").textContent = "Network error. Try again.";
    console.error("Login error:", err);
  }
}

async function handleSignup() {
  const username = $("signupUsername").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;
  $("signupError").textContent = "";
  if (!username || !email || !password) {
    $("signupError").textContent = "Username, email and password required.";
    return;
  }
  if (password.length < 6) {
    $("signupError").textContent = "Password must be at least 6 characters.";
    return;
  }
  try {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      $("signupError").textContent = data.message || "Sign up failed.";
      return;
    }
    localStorage.setItem("authToken", data.token);
    if (data.user) {
      $("userInfo").textContent = data.user.username || data.user.email;
    }
    // Hide modal and show dashboard
    const modal = $("authModal");
    const dash = $("dashboard");
    if (modal) {
      modal.style.display = "none";
      modal.classList.add("hidden");
    }
    if (dash) {
      dash.style.display = "block";
      dash.classList.remove("hidden");
    }
    loadStats();
    startTimer();
  } catch (err) {
    $("signupError").textContent = "Network error. Try again.";
    console.error("Signup error:", err);
  }
}

function handleLogout() {
  localStorage.removeItem("authToken");
  $("authModal").classList.remove("hidden");
  $("dashboard").classList.add("hidden");
  stopTimer();
  $("loginEmail").value = "";
  $("loginPassword").value = "";
  $("loginError").textContent = "";
  $("signupUsername").value = "";
  $("signupEmail").value = "";
  $("signupPassword").value = "";
  $("signupError").textContent = "";
  showLogin();
}

// Expose for onclick in HTML
window.showLogin = showLogin;
window.showSignup = showSignup;
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.handleLogout = handleLogout;

// =================================================


// helpers
function formatNumber(n){ if(n===null||n===undefined) return "—"; return Number(n).toString(); }
function statusClass(r){
  if(!r) return "badge warn";
  const s = r.toString().toLowerCase();
  if(s.includes("excellent") || s.includes("good") || s.includes("up")) return "badge good";
  if(s.includes("concerning") || s.includes("acceptable") || s.includes("warn")) return "badge warn";
  return "badge bad";
}

// render functions
function renderOverview(statsObj){
  const sites = Object.keys(statsObj);
  $("totalSites").innerText = sites.length;
  let avgUptime = 0, avgLatency = 0, slowCount=0, count = 0;
  sites.forEach(site=>{
    const s = statsObj[site];
    if(s.uptimePercent) avgUptime += parseFloat(s.uptimePercent);
    if(s.averageResponseTime) avgLatency += parseFloat(s.averageResponseTime);
    slowCount += (s.slowRequests || 0);
    count++;
  });
  $("overallUptime").innerText = count? (avgUptime/count).toFixed(2) + "%" : "—";
  $("avgLatency").innerText = count? Math.round(avgLatency/count) + " ms" : "—";
  $("slowCount").innerText = slowCount;
}

function makeCard(site, s){
  const card = document.createElement("div");
  card.className = "card";
  card.dataset.site = site;

  const header = document.createElement("div");
  header.className = "row";
  header.innerHTML = `<h3>${site}</h3><div class="${statusClass(s.lastRating)}">${s.lastRating || "N/A"}</div>`;
  card.appendChild(header);

  const row1 = document.createElement("div");
  row1.className = "row";
  row1.innerHTML = `<div class="metric">Uptime</div><div class="value">${s.uptimePercent ?? "—"}%</div>`;
  card.appendChild(row1);

  const row2 = document.createElement("div");
  row2.className = "row";
  row2.innerHTML = `<div class="metric">Last / Avg / Min</div><div class="value">${s.lastResponseTime ?? "—"} / ${s.averageResponseTime ?? "—"} / ${s.minResponseTime ?? "—"} ms</div>`;
  card.appendChild(row2);

  const row3 = document.createElement("div");
  row3.className = "row";
  row3.innerHTML = `<div class="metric">Slow Req / 5xx</div><div class="value">${s.slowRequests || 0} / ${s.serverErrors || 0}</div>`;
  card.appendChild(row3);

  const row4 = document.createElement("div");
  row4.className = "row";
  row4.innerHTML = `<div class="metric">DNS Time</div><div class="value">${s.avgDnsTime !== null && s.avgDnsTime !== undefined ? s.avgDnsTime + ' ms' : "Calculating..."}</div>`;
  card.appendChild(row4);

  const actions = document.createElement("div");
  actions.className = "row card-actions";
  const detailsBtn = document.createElement("button");
  detailsBtn.className = "btn-details";
  detailsBtn.textContent = "Details";
  detailsBtn.onclick = (e) => { e.stopPropagation(); openDetails({ currentTarget: card }); };
  const removeBtn = document.createElement("button");
  removeBtn.className = "btn-remove";
  removeBtn.textContent = "Remove";
  removeBtn.onclick = (e) => { e.stopPropagation(); removeSite(site); };
  actions.appendChild(detailsBtn);
  actions.appendChild(removeBtn);
  card.appendChild(actions);

  return card;
}

window.openDetails = function(ev){
  const site = ev.currentTarget.dataset.site;
  showDrawer(site);
};

// Close drawer button (bind once)
document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("closeDrawer");
  if (closeBtn) closeBtn.onclick = () => document.getElementById("drawer").classList.add("hidden");

  const visibilityBtn = document.getElementById("checkVisibilityBtn");
  if (visibilityBtn) visibilityBtn.onclick = checkVisibility;
  loadAIHistory();
});




let activeChart = null; // track chart instance to destroy before re-rendering

async function showDrawer(site){
  const content = $("drawerContent");
  content.innerHTML = `<h2>${site}</h2><div class="padded small">Loading...</div>`;
  $("drawer").classList.remove("hidden");

  try {
    const res = await fetch('/stats', { headers: authHeaders() });
    const data = await res.json();
    const s = data[site];
    if(!s){ content.innerHTML = `<div class="padded">No data</div>`; return; }

    // SSL warning badge
    const sslWarning = s.sslExpiryDays !== null && s.sslExpiryDays <= 30
      ? `<span class="badge bad">⚠️ SSL expires in ${s.sslExpiryDays} days</span>`
      : `<span class="badge good">🔒 SSL valid (${s.sslExpiryDays ?? '—'} days)</span>`;

    content.innerHTML = `
      <div class="drawer-stats-grid">
        <div class="drawer-stat"><div class="drawer-stat-label">Uptime</div><div class="drawer-stat-value">${s.uptimePercent ?? '—'}%</div></div>
        <div class="drawer-stat"><div class="drawer-stat-label">Avg Response</div><div class="drawer-stat-value">${s.averageResponseTime ?? '—'} ms</div></div>
        <div class="drawer-stat"><div class="drawer-stat-label">DNS Time</div><div class="drawer-stat-value">${s.avgDnsTime ?? '—'} ms</div></div>
        <div class="drawer-stat"><div class="drawer-stat-label">SSL</div><div class="drawer-stat-value">${sslWarning}</div></div>
        <div class="drawer-stat"><div class="drawer-stat-label">Min / Max</div><div class="drawer-stat-value">${s.minResponseTime ?? '—'} / ${s.maxResponseTime ?? '—'} ms</div></div>
        <div class="drawer-stat"><div class="drawer-stat-label">Server Errors</div><div class="drawer-stat-value">${s.serverErrors || 0}</div></div>
      </div>

      <div class="chart-section">
        <h3>Response Time Trend</h3>
        <div class="chart-wrapper">
          <canvas id="latencyChart"></canvas>
        </div>
      </div>
    `;

    // destroy previous chart if exists
    if(activeChart) { activeChart.destroy(); activeChart = null; }

    // build chart data from latencyHistory
    const history = s.latencyHistory || [];
    const labels = history.map((p, i) => {
      const d = new Date(p.time);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });
    const values = history.map(p => p.latency);

    const ctx = document.getElementById("latencyChart").getContext("2d");
    activeChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Response Time (ms)",
          data: values,
          borderColor: "#6366f1",
          backgroundColor: "rgba(99,102,241,0.1)",
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.parsed.y} ms`
            }
          }
        },
        scales: {
          x: {
            ticks: { maxTicksLimit: 8, color: "#9ca3af" },
            grid: { color: "rgba(255,255,255,0.05)" }
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#9ca3af", callback: v => v + " ms" },
            grid: { color: "rgba(255,255,255,0.05)" }
          }
        }
      }
    });

  } catch(e) {
    content.innerHTML = `<div class="padded">Error loading details</div>`;
    console.error(e);
  }
}

// ================= MAIN =================
async function loadStats(){
  try {
    const res = await fetch('/stats', {
      headers: authHeaders()
    });

    if(!res.ok) throw new Error('Failed /stats');

    const data = await res.json();
    renderOverview(data);

    const container = $('cards');
    container.innerHTML = '';
    Object.keys(data).sort().forEach(site=>{
      container.appendChild(makeCard(site, data[site]));
    });

    $('lastUpdated').innerText = new Date().toLocaleString();
  } catch (err){
    console.error('Failed to load stats', err);
    stopTimer();
  }
}

// ================= ADD SITE =================
async function addSite() {
  const url = $("siteInput").value.trim();
  if (!url) return alert("Enter a valid URL");

  try {
    const res = await fetch("/api/add-site", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    alert(data.message || (data.success ? "Monitoring started." : "Failed."));
    if (data.success) loadStats();
  } catch (err) {
    alert("Failed to add site. Check connection.");
    console.error(err);
  }
}

// ================= REMOVE SITE =================
async function removeSite(url) {
  if (!url) return;
  if (!confirm(`Stop monitoring "${url}"? This will remove the site and its logs.`)) return;
  try {
    const res = await fetch("/api/remove-site", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ url })
    });
    const data = await res.json();
    alert(data.message || (data.success ? "Monitoring stopped." : "Failed."));
    if (data.success) loadStats();
  } catch (err) {
    alert("Failed to remove site. Check connection.");
    console.error(err);
  }
}

// ================= TIMER =================
function startTimer(){ stopTimer(); timer = setInterval(loadStats, REFRESH_INTERVAL); }
function stopTimer(){ if(timer) clearInterval(timer); timer = null; }

// ================= STARTUP (auth check) =================
async function initApp() {
  const token = getToken();
  if (!token) {
    $("authModal").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
    return;
  }
  try {
    const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (res.ok && data.success && data.user) {
      $("userInfo").textContent = data.user.username || data.user.email;
      $("authModal").classList.add("hidden");
      $("dashboard").classList.remove("hidden");
      loadStats();
      startTimer();
    } else {
      localStorage.removeItem("authToken");
      $("authModal").classList.remove("hidden");
      $("dashboard").classList.add("hidden");
    }
  } catch {
    localStorage.removeItem("authToken");
    $("authModal").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
  }
}

initApp();

// ================= AI SEARCH VISIBILITY =================
window.checkVisibility = async function() {
  const brandName = $("brandInput").value.trim();
  const keyword = $("keywordInput").value.trim();
  const resultsDiv = $("aiResults");

  if (!brandName || !keyword) {
    alert("Please enter both a brand name and a keyword.");
    return;
  }

  // Show loading state
  resultsDiv.innerHTML = `
    <div class="ai-result-card loading">
      <div class="ai-checking">⏳ Asking Gemini about "${keyword}"...</div>
    </div>
  `;

  try {
    const res = await fetch("/api/ai-visibility", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ brandName, keyword })
    });

    const data = await res.json();

    if (!data.success) {
      resultsDiv.innerHTML = `<div class="ai-result-card error">❌ ${data.message}</div>`;
      return;
    }

const isVisible = data.status === "VISIBLE";
const checkedAt = new Date(data.checkedAt).toLocaleString();

// rank badge
const rankBadge = isVisible
  ? `<span class="ai-rank-badge">🏆 Rank #${data.rank} of ${data.totalRecommendations}</span>`
  : "";

const card = document.createElement("div");
card.className = `ai-result-card ${isVisible ? "visible" : "hidden-result"}`;
card.innerHTML = `
  <div class="ai-result-header">
    <span class="ai-brand">${data.brandName}</span>
    <div class="ai-badges">
      <span class="ai-badge ${isVisible ? "badge good" : "badge bad"}">
        ${isVisible ? "✅ VISIBLE" : "❌ HIDDEN"}
      </span>
      ${rankBadge}
    </div>
  </div>
  <div class="ai-keyword">🔍 Keyword: "${data.keyword}"</div>
  <div class="ai-snippet">${isVisible ? `💬 "${data.mentionSnippet}"` : "Your brand was not mentioned in the AI response."}</div>
  <div class="ai-time">🕐 Checked at ${checkedAt}</div>
  <details class="ai-raw">
    <summary>See full AI response</summary>
    <div class="ai-raw-content">${data.rawResponse}</div>
  </details>
`;

    // Clear loading and add result
    if (resultsDiv.querySelector(".loading")) {
      resultsDiv.innerHTML = "";
    }
    resultsDiv.insertBefore(card, resultsDiv.firstChild);
    loadAIHistory(); // refresh history after each new check

  } catch (err) {
    resultsDiv.innerHTML = `<div class="ai-result-card error">❌ Network error. Try again.</div>`;
    console.error(err);
  }
};

// ================= AI VISIBILITY HISTORY =================
async function loadAIHistory() {
  const historyDiv = document.getElementById("aiHistory");
  if (!historyDiv) return;

  try {
    const res = await fetch("/api/ai-visibility/history", {
      headers: authHeaders()
    });
    const data = await res.json();

    if (!data.success || data.history.length === 0) {
      historyDiv.innerHTML = `<div class="ai-history-empty">No history yet — run your first check above!</div>`;
      return;
    }

    historyDiv.innerHTML = `
      <table class="ai-history-table">
        <thead>
          <tr>
            <th>Brand</th>
            <th>Keyword</th>
            <th>Status</th>
            <th>Rank</th>
            <th>Checked At</th>
          </tr>
        </thead>
        <tbody>
          ${data.history.map(log => `
            <tr>
              <td>${log.brandName}</td>
              <td>${log.keyword}</td>
              <td>
                <span class="${log.status === "VISIBLE" ? "badge good" : "badge bad"}">
                  ${log.status === "VISIBLE" ? "✅ VISIBLE" : "❌ HIDDEN"}
                </span>
                ${log.matchedAs ? `<div class="ai-aliases">matched as: ${log.matchedAs}</div>` : ""}
              </td>
              <td>${log.rank ? `#${log.rank} of ${log.totalRecommendations}` : "—"}</td>
              <td>${new Date(log.checkedAt).toLocaleString()}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error("Failed to load AI history:", err);
  }
}

// ================= AI VISIBILITY MONITORS =================

async function loadMonitors() {
  const listDiv = document.getElementById("monitorsList");
  if (!listDiv) return;

  try {
    const res = await fetch("/api/ai-visibility/monitors", {
      headers: authHeaders()
    });
    const data = await res.json();

    if (!data.success || data.monitors.length === 0) {
      listDiv.innerHTML = `<div class="ai-history-empty">No monitors saved yet.</div>`;
      return;
    }

    listDiv.innerHTML = `
      <table class="ai-history-table">
        <thead>
          <tr>
            <th>Brand</th>
            <th>Keyword</th>
            <th>Last Checked</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${data.monitors.map(m => `
            <tr>
              <td>
                ${m.brandName}
                ${m.aliases && m.aliases.length > 0 
                  ? `<div class="ai-aliases">also: ${m.aliases.join(", ")}</div>` 
                  : ""}
              </td>
              <td>${m.keyword}</td>
              <td>${m.lastCheckedAt ? new Date(m.lastCheckedAt).toLocaleString() : "⏳ Waiting for first check..."}</td>
              <td class="monitor-actions">
  <button class="btn-details" onclick="showTrend('${m.brandName}', '${m.keyword}')">📈 Trend</button>
  <button class="btn-remove" onclick="deleteMonitor('${m._id}')">Remove</button>
</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error("Failed to load monitors:", err);
  }
}

window.deleteMonitor = async function(id) {
  if (!confirm("Remove this monitor?")) return;
  try {
    const res = await fetch(`/api/ai-visibility/monitor/${id}`, {
      method: "DELETE",
      headers: authHeaders()
    });
    const data = await res.json();
    if (data.success) loadMonitors();
    else alert(data.message || "Failed to remove monitor");
  } catch (err) {
    console.error("Delete monitor error:", err);
  }
};

async function saveMonitor() {
  const brandName = document.getElementById("monitorBrandInput").value.trim();
  const keyword = document.getElementById("monitorKeywordInput").value.trim();
  const aliasRaw = document.getElementById("monitorAliasInput").value.trim();
  const aliases = aliasRaw ? aliasRaw.split(",").map(a => a.trim()).filter(a => a !== "") : [];

  if (!brandName || !keyword) {
    alert("Please enter both brand name and keyword.");
    return;
  }

  try {
    const res = await fetch("/api/ai-visibility/monitor", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders()
      },
      body: JSON.stringify({ brandName, keyword, aliases })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById("monitorBrandInput").value = "";
      document.getElementById("monitorKeywordInput").value = "";
      document.getElementById("monitorAliasInput").value = "";
      loadMonitors();
    } else {
      alert(data.message || "Failed to save monitor");
    }
  } catch (err) {
    console.error("Save monitor error:", err);
  }
}

// bind save button
document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("saveMonitorBtn");
  if (saveBtn) saveBtn.onclick = saveMonitor;
});

// load monitors on startup
document.addEventListener("DOMContentLoaded", () => {
  loadMonitors();
});

// ================= AI TREND CHART =================
let activeTrendChart = null;

window.showTrend = async function(brandName, keyword) {
  const section = document.getElementById("aiTrendSection");
  const title = document.getElementById("aiTrendTitle");
  const canvas = document.getElementById("aiTrendChart");

  section.classList.remove("hidden");
  title.textContent = `"${brandName}" — "${keyword}"`;

  // destroy previous chart
  if (activeTrendChart) { activeTrendChart.destroy(); activeTrendChart = null; }

  try {
    const params = new URLSearchParams({ brandName, keyword });
    const res = await fetch(`/api/ai-visibility/trend?${params}`, {
      headers: authHeaders()
    });
    const data = await res.json();

    if (!data.success || data.trend.length === 0) {
      section.innerHTML += `<div class="ai-history-empty">Not enough data yet — check back after a few daily checks.</div>`;
      return;
    }

    const labels = data.trend.map(d => d.date);
    const ranks = data.trend.map(d => d.rank ?? 6); // 6 = hidden (off chart)
    const colors = data.trend.map(d => d.status === "VISIBLE" ? "#10b981" : "#ef4444");

    const ctx = canvas.getContext("2d");
    activeTrendChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Rank Position",
          data: ranks,
          borderColor: "#6366f1",
          backgroundColor: "rgba(99,102,241,0.1)",
          borderWidth: 2,
          pointRadius: 6,
          pointBackgroundColor: colors,
          pointBorderColor: colors,
          pointHoverRadius: 8,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const val = ctx.parsed.y;
                return val >= 6 ? "❌ HIDDEN" : `✅ Rank #${val}`;
              }
            }
          }
        },
        scales: {
          y: {
            reverse: true, // rank 1 at top, rank 5 at bottom
            min: 1,
            max: 6,
            ticks: {
              stepSize: 1,
              color: "#9ca3af",
              callback: v => v >= 6 ? "Hidden" : `#${v}`
            },
            grid: { color: "rgba(255,255,255,0.05)" }
          },
          x: {
            ticks: { color: "#9ca3af", maxTicksLimit: 10 },
            grid: { color: "rgba(255,255,255,0.05)" }
          }
        }
      }
    });

  } catch (err) {
    console.error("Trend chart error:", err);
  }
};

// Close trend chart
document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("closeTrendBtn");
  if (closeBtn) closeBtn.onclick = () => {
    document.getElementById("aiTrendSection").classList.add("hidden");
    if (activeTrendChart) { activeTrendChart.destroy(); activeTrendChart = null; }
  };
});