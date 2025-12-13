// script.js - dashboard frontend (expects /stats endpoint)
const REFRESH_INTERVAL = 5000; // ms
let autoRefresh = true;
let timer = null;

const $ = id => document.getElementById(id);

// Get token from localStorage
function getToken() {
  return localStorage.getItem("sitelens_token") || authToken;
}

function setToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem("sitelens_token", token);
  } else {
    localStorage.removeItem("sitelens_token");
  }
}

// base API helper with auth
const api = (path, opts = {}) => {
  const token = getToken();
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(path, {
    headers,
    ...opts,
  });
};

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

  // sparkline canvas
  const canvas = document.createElement("canvas");
  canvas.className = "sparkline";
  canvas.height = 70;
  card.appendChild(canvas);

  // footer details: status codes, SSL expiry, recent downtimes
  const footer = document.createElement("div");
  footer.className = "card-footer small";
  footer.innerHTML = `
    <div>SSL: <strong>${s.sslExpiryDays ?? "N/A"}d</strong></div>
    <div>Recent: <strong>${(s.recentDowntimes || []).slice(-3).join(", ") || "—"}</strong></div>
    <div class="codeList">${Object.entries(s.statusCodes || {}).map(([k,v])=>`<span class="small">${k}: ${v}</span>`).join(" ")}</div>
    <div class="actions">
      <button class="small" data-site="${site}" onclick="openDetails(event)">Details</button>
      <button class="small danger" data-site="${site}" onclick="stopSite(event)">Stop</button>
    </div>
  `;
  card.appendChild(footer);

  // draw sparkline if latencyHistory exists (we expect server to send recent latencies in lastResponseTime only; fallback)
  const ctx = canvas.getContext("2d");
  const latData = (s.latencyHistory || []).slice(-20).map(d => d.latency || d);
  if(latData.length>0){
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: latData.map((_,i)=>i),
        datasets: [{ data: latData, borderWidth:1, pointRadius:0, fill:true, tension:0.3 }]
      },
      options: { plugins:{legend:{display:false}}, scales:{x:{display:false}, y:{display:false}}, elements:{line:{borderColor:'#06b6d4',backgroundColor:'rgba(6,182,212,0.08)'}} }
    });
  } else {
    // placeholder tiny graphic
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px Arial';
    ctx.fillText('no history',10,35);
  }

  return card;
}

window.openDetails = function(ev){
  const site = ev.currentTarget.dataset.site;
  showDrawer(site);
};

// drawer content
async function showDrawer(site){
  const content = $("drawerContent");
  content.innerHTML = `<h2>${site}</h2><div class="padded small">Loading...</div>`;
  $("drawer").classList.remove("hidden");
  // fetch expanded info from /stats (we already have it in cache)
  try {
    const res = await fetch('/stats');
    const data = await res.json();
    const s = data[site];
    if(!s){ content.innerHTML = `<div class="padded">No data</div>`; return; }
    content.innerHTML = `
      <h3>Metrics</h3>
      <div class="padded">Uptime: <strong>${s.uptimePercent ?? '—'}%</strong></div>
      <div class="padded">Average response: <strong>${s.averageResponseTime ?? '—'} ms</strong></div>
      <div class="padded">Successes: <strong>${s.successes ?? 0}</strong> | Failures: <strong>${s.failures ?? 0}</strong></div>
      <h3>Recent status codes</h3>
      <div class="padded">${Object.entries(s.statusCodes||{}).map(([k,v])=>`<div>${k}: ${v}</div>`).join('') || '—'}</div>
      <h3>Recent downtimes</h3>
      <div class="padded">${(s.recentDowntimes||[]).slice(-10).reverse().map(t=>`<div>${t}</div>`).join('') || '—'}</div>
    `;
  } catch (e){
    content.innerHTML = `<div class="padded">Error loading details</div>`;
  }
}

// close drawer
$('closeDrawer')?.addEventListener?.('click', ()=> $('drawer').classList.add('hidden'));

// main refresh routine
let lastStats = null;
async function loadStats(){
  try {
    const res = await fetch('/stats');
    if(!res.ok) throw new Error('Failed /stats');
    const data = await res.json();
    lastStats = data;

    // enrich: keep small latencyHistory if not present (safe fallback)
    for(const site in data){
      if(!data[site].latencyHistory) data[site].latencyHistory = [];
    }

    renderOverview(data);

    const container = $('cards');
    container.innerHTML = '';
    for(const site of Object.keys(data).sort()){
      const card = makeCard(site, data[site]);
      container.appendChild(card);
    }

    $('lastUpdated').innerText = new Date().toLocaleString();
  } catch (err){
    console.error('Failed to load stats', err);
  }
}

// UI controls
$('refreshBtn').addEventListener('click', ()=> loadStats());
$('autoRefreshToggle').addEventListener('change', (e)=>{
  autoRefresh = e.target.checked;
  if(autoRefresh) startTimer(); else stopTimer();
});

function startTimer(){ stopTimer(); timer = setInterval(()=> loadStats(), REFRESH_INTERVAL); }
function stopTimer(){ if(timer) clearInterval(timer); timer = null; }

// Add new site from the search bar (top of dashboard)
window.addSite = async function addSite(){
  const input = $("siteInput");
  const raw = input.value.trim();
  if(!raw){
    alert("Please enter a website URL");
    return;
  }

  try {
    const res = await api("/api/add-site", {
      method: "POST",
      body: JSON.stringify({ url: raw }),
    });
    const data = await res.json();
    if(!res.ok || !data.success){
      throw new Error(data.message || "Failed to add site");
    }
    // refresh metrics immediately so the new site shows up
    await loadStats();
    input.value = "";
  } catch (err){
    console.error("Failed to add site", err);
    alert(err.message || "Unable to add site. Check the URL and try again.");
  }
};

// allow pressing Enter in the input to trigger addSite
$("siteInput")?.addEventListener?.("keyup", (e)=>{
  if(e.key === "Enter") addSite();
});

// Stop monitoring a site (from card button)
window.stopSite = async function stopSite(ev){
  const site = ev.currentTarget.dataset.site;
  if(!site) return;
  if(!confirm(`Stop monitoring ${site}?`)) return;

  try {
    const res = await api("/api/remove-site", {
      method: "POST",
      body: JSON.stringify({ url: site }),
    });
    const data = await res.json();
    if(!res.ok || !data.success){
      throw new Error(data.message || "Failed to remove site");
    }
    await loadStats();
  } catch (err){
    console.error("Failed to remove site", err);
    alert(err.message || "Unable to remove site.");
  }
};

// ==================== AUTHENTICATION ====================

function showLogin() {
  $("loginForm").classList.remove("hidden");
  $("signupForm").classList.add("hidden");
  document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");
}

function showSignup() {
  $("signupForm").classList.remove("hidden");
  $("loginForm").classList.add("hidden");
  document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");
}

async function handleLogin() {
  const email = $("loginEmail").value;
  const password = $("loginPassword").value;
  const errorEl = $("loginError");

  if (!email || !password) {
    errorEl.textContent = "Please fill all fields";
    return;
  }

  try {
    const res = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || "Login failed");
    }

    setToken(data.token);
    showDashboard(data.user);
  } catch (err) {
    errorEl.textContent = err.message || "Login failed";
  }
}

async function handleSignup() {
  const username = $("signupUsername").value;
  const email = $("signupEmail").value;
  const password = $("signupPassword").value;
  const errorEl = $("signupError");

  if (!username || !email || !password) {
    errorEl.textContent = "Please fill all fields";
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = "Password must be at least 6 characters";
    return;
  }

  try {
    const res = await api("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || "Signup failed");
    }

    setToken(data.token);
    showDashboard(data.user);
  } catch (err) {
    errorEl.textContent = err.message || "Signup failed";
  }
}

function handleLogout() {
  setToken(null);
  $("authModal").classList.remove("hidden");
  $("dashboard").classList.add("hidden");
  stopTimer();
}

function showDashboard(user) {
  $("authModal").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  if (user) {
    $("userInfo").textContent = `👤 ${user.username}`;
  }
  loadStats();
  startTimer();
}

// Check if user is already logged in
async function checkAuth() {
  const token = getToken();
  if (!token) {
    $("authModal").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
    return;
  }

  try {
    const res = await api("/api/auth/me");
    const data = await res.json();
    if (data.success && data.user) {
      showDashboard(data.user);
    } else {
      throw new Error("Invalid token");
    }
  } catch (err) {
    setToken(null);
    $("authModal").classList.remove("hidden");
    $("dashboard").classList.add("hidden");
  }
}

// startup
checkAuth();
