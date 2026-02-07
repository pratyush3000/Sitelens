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
});

// ================= DRAWER =================
async function showDrawer(site){
  const content = $("drawerContent");
  content.innerHTML = `<h2>${site}</h2><div class="padded small">Loading...</div>`;
  $("drawer").classList.remove("hidden");

  try {
    const res = await fetch('/stats', {
      headers: authHeaders()
    });
    const data = await res.json();
    const s = data[site];
    if(!s){ content.innerHTML = `<div class="padded">No data</div>`; return; }

    content.innerHTML = `
      <div class="padded">Uptime: ${s.uptimePercent ?? '—'}%</div>
      <div class="padded">Avg response: ${s.averageResponseTime ?? '—'} ms</div>
    `;
  } catch {
    content.innerHTML = `<div class="padded">Error loading details</div>`;
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
