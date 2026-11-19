// MintRadar app — static site, reads watch data files + the registry contract.
import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js";

const CFG = window.MINTRADAR_CONFIG;
const REGISTRY_ABI = [
  "function agentIdOf(address) view returns (string)",
  "function addressOfName(bytes32) view returns (address)",
  "function isFollowing(address,address) view returns (bool)",
  "function followerCount(address) view returns (uint256)",
  "function followingCount(address) view returns (uint256)",
  "function registeredCount() view returns (uint256)",
  "function getRegisteredAgents(uint256,uint256) view returns (address[])",
  "function register(string)",
  "function follow(address)",
  "function unfollow(address)",
];

const $ = (id) => document.getElementById(id);
const short = (a) => a.slice(0, 6) + "…" + a.slice(-4);
const state = { agents: [], radar: null, wallet: null, signer: null, contract: null, readContract: null };

function readProvider() {
  return new ethers.JsonRpcProvider(CFG.BSC_RPC);
}
function getReadContract() {
  if (!CFG.CONTRACT_ADDRESS) return null;
  if (!state.readContract) {
    state.readContract = new ethers.Contract(CFG.CONTRACT_ADDRESS, REGISTRY_ABI, readProvider());
  }
  return state.readContract;
}

// ---------- data ----------
async function loadData() {
  const [agentsRes, radarRes] = await Promise.all([
    fetch("data/agents.json").then((r) => r.json()),
    fetch("data/radar.json").then((r) => r.json()),
  ]);
  state.agents = agentsRes.agents;
  state.radar = radarRes;
}

// ---------- radar ----------
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
function renderRadar() {
  const feed = $("radarFeed");
  feed.innerHTML = "";
  for (const ev of state.radar.events) {
    const div = document.createElement("div");
    div.className = "event";
    const agentLinks = (ev.agents || []).map((a) => `<a href="#/agent/${a}"><b>${a}</b></a>`).join(", ");
    div.innerHTML = `
      <div class="event-top">
        <span class="event-name">${ev.name} <span class="event-sym">$${ev.symbol}</span></span>
        <span class="chip ${ev.cost}">${ev.cost}</span>
        <span class="chip kind">${ev.kind === "nft" ? "NFT" : "Token"}</span>
      </div>
      <div class="event-meta">${fmtDate(ev.at)} · ${ev.minters.toLocaleString()} minters · <a href="https://bscscan.com/address/${ev.contract}" target="_blank" rel="noopener">${short(ev.contract)}</a></div>
      <p class="event-note">${ev.note}</p>
      ${agentLinks ? `<div class="event-agents">Tracked agents in: ${agentLinks}${ev.agentsNote ? " · " + ev.agentsNote : ""}</div>` : (ev.agentsNote ? `<div class="event-agents">${ev.agentsNote}</div>` : "")}
    `;
    feed.appendChild(div);
  }
  $("radarUpdated").textContent = "Source: " + state.radar.source + " · Last updated " + fmtDate(state.radar.updatedAt);
  $("statEvents").textContent = state.radar.events.length;
  const c = getReadContract();
  if (c) {
    c.registeredCount()
      .then((n) => {
        const count = Number(n);
        $("statRegistered").textContent = count;
        const chip = $("chipRegistered");
        if (chip) chip.textContent = "✅ " + count + (count === 1 ? " agent" : " agents") + " registered on-chain";
      })
      .catch(() => { $("statRegistered").textContent = "–"; });
  }
}

// ---------- agents ----------
function agentCard(a) {
  const div = document.createElement("div");
  div.className = "agent-card";
  const initials = a.agentId.replace(/\.ai$/i, "").slice(0, 2).toUpperCase();
  div.innerHTML = `
    <div class="agent-head">
      <div class="avatar">${initials}</div>
      <div>
        <div class="arank">RANK #${a.rank}</div>
        <div class="aname"><a href="#/agent/${a.agentId}">${a.agentId}</a></div>
      </div>
    </div>
    <div class="aaddr">${short(a.address)}</div>
    <div class="row">
      <span class="followers" data-fcount="${a.address}">… followers</span>
      <button class="btn btn-ghost" data-follow="${a.address}">Follow</button>
    </div>`;
  return div;
}
function renderAgents(filter = "") {
  const grid = $("agentGrid");
  grid.innerHTML = "";
  const list = state.agents.filter((a) => a.agentId.toLowerCase().includes(filter.toLowerCase()));
  for (const a of list) grid.appendChild(agentCard(a));
  hydrateFollowUI();
}

async function followerCounts(addresses) {
  const c = getReadContract();
  if (!c) return new Map(addresses.map((a) => [a, null]));
  const out = new Map();
  await Promise.all(addresses.map(async (a) => {
    try { out.set(a, Number(await c.followerCount(a))); } catch { out.set(a, null); }
  }));
  return out;
}

async function hydrateFollowUI() {
  const els = [...document.querySelectorAll("[data-fcount]")];
  const counts = await followerCounts(els.map((e) => e.dataset.fcount));
  for (const el of els) {
    const n = counts.get(el.dataset.fcount);
    el.textContent = n === null ? "not registered yet" : `${n} follower${n === 1 ? "" : "s"}`;
  }
  const myAddr = state.wallet;
  const c = getReadContract();
  for (const btn of document.querySelectorAll("[data-follow]")) {
    const target = btn.dataset.follow;
    if (!c) { btn.disabled = true; btn.textContent = "Soon"; continue; }
    if (!myAddr) { btn.disabled = false; btn.textContent = "Follow"; continue; }
    if (target.toLowerCase() === myAddr.toLowerCase()) { btn.disabled = true; btn.textContent = "You"; continue; }
    try {
      const following = await c.isFollowing(myAddr, target);
      btn.textContent = following ? "Following ✓" : "Follow";
      btn.dataset.state = following ? "following" : "not";
    } catch { btn.textContent = "Follow"; }
  }
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-follow]");
  if (!btn) return;
  const target = btn.dataset.follow;
  if (!CFG.CONTRACT_ADDRESS) return;
  if (!state.signer) { await connectWallet(); if (!state.signer) return; }
  btn.disabled = true;
  try {
    const fn = btn.dataset.state === "following" ? "unfollow" : "follow";
    const tx = await state.contract[fn](target);
    btn.textContent = "Confirming…";
    await tx.wait();
    btn.dataset.state = fn === "follow" ? "following" : "not";
    btn.textContent = fn === "follow" ? "Following ✓" : "Follow";
    hydrateFollowUI();
  } catch (err) {
    btn.disabled = false;
    alert("Transaction failed or was rejected. If the agent is not registered on MintRadar yet, they must register before they can be followed.");
  }
});

// ---------- agent profile ----------
async function renderAgentProfile(agentId) {
  const box = $("agentProfile");
  const a = state.agents.find((x) => x.agentId.toLowerCase() === agentId.toLowerCase());
  if (!a) { box.innerHTML = `<div class="card">Agent <b>${agentId}</b> is not in the tracked directory.</div>`; return; }
  box.innerHTML = `
    <div class="card">
      <div class="arank">TRACKED AGENT · RANK #${a.rank}</div>
      <h2 style="margin:6px 0">${a.agentId} <span class="badge-verified" id="profBadge"></span></h2>
      <p class="aaddr">${a.address} · <a href="https://bscscan.com/address/${a.address}" target="_blank" rel="noopener">BscScan</a></p>
      <div class="row" style="display:flex;gap:18px;align-items:center">
        <span class="followers" data-fcount="${a.address}">… followers</span>
        <button class="btn btn-gold" data-follow="${a.address}">Follow</button>
      </div>
      <p class="foot-note">✅ Verified means this Agent ID resolves through Binance's resolution service to the address that registered it on MintRadar.</p>
    </div>
    <div class="card"><h3>Recent radar detections</h3><div id="profEvents"></div></div>`;
  const evBox = $("profEvents");
  const evs = state.radar.events.filter((ev) => (ev.agents || []).some((x) => x.toLowerCase() === a.agentId.toLowerCase()));
  evBox.innerHTML = evs.length
    ? evs.map((ev) => `<p>📡 <b>${ev.name}</b> — ${fmtDate(ev.at)} · ${ev.note}</p>`).join("")
    : `<p class="sub">No detections in the current feed window.</p>`;
  // Verified badge: name resolution must match the registered address.
  const c = getReadContract();
  if (c) {
    try {
      const regAddr = await c.addressOfName(ethers.keccak256(ethers.toUtf8Bytes(a.agentId.toLowerCase())));
      if (regAddr !== ethers.ZeroAddress && regAddr.toLowerCase() === a.address.toLowerCase()) {
        $("profBadge").textContent = "✅ Verified Agent";
      }
    } catch { /* read failed; leave unbadged */ }
  }
  hydrateFollowUI();
}

// ---------- leaderboard ----------
async function renderLeaderboard() {
  const body = $("leaderboardBody");
  const c = getReadContract();
  if (!c) {
    body.innerHTML = `<div class="card">The registry contract is deploying — the leaderboard goes live with it. Registrations and follows will appear here in real time.</div>`;
    return;
  }
  body.innerHTML = `<div class="card">Loading from BNB Chain…</div>`;
  try {
    const total = Number(await c.registeredCount());
    if (total === 0) { body.innerHTML = `<div class="card">No registrations yet — be the first.</div>`; return; }
    const addrs = await c.getRegisteredAgents(0, total);
    const rows = [];
    for (const addr of addrs) {
      const [name, followers] = await Promise.all([c.agentIdOf(addr), c.followerCount(addr)]);
      rows.push({ name, addr, followers: Number(followers) });
    }
    rows.sort((x, y) => y.followers - x.followers);
    body.innerHTML = `<table class="lb"><thead><tr><th>#</th><th>Agent</th><th>Followers</th><th></th></tr></thead><tbody>${
      rows.map((r, i) => `<tr class="rank${i + 1}"><td>${i + 1}</td><td><a href="#/agent/${r.name}"><b>${r.name}</b></a><br><span class="aaddr">${short(r.addr)}</span></td><td>${r.followers}</td><td><button class="btn btn-ghost" data-follow="${r.addr}">Follow</button></td></tr>`).join("")
    }</tbody></table>`;
    hydrateFollowUI();
  } catch {
    body.innerHTML = `<div class="card">Could not read the contract right now. Try again in a moment.</div>`;
  }
}

// ---------- register ----------
async function renderMyProfile() {
  const el = $("myProfile");
  const c = getReadContract();
  if (!c) { el.textContent = "The registry contract is deploying — registration opens at launch."; return; }
  if (!state.wallet) { el.textContent = "Connect your wallet to see your status."; return; }
  const name = await c.agentIdOf(state.wallet);
  el.innerHTML = name
    ? `You are registered as <b>${name}</b> ✅ · <span data-fcount="${state.wallet}"></span>`
    : "This wallet has not registered an Agent ID yet.";
  hydrateFollowUI();
}

$("regBtn").addEventListener("click", async () => {
  const status = $("regStatus");
  const name = $("regName").value.trim().toLowerCase();
  status.className = "status";
  if (!CFG.CONTRACT_ADDRESS) { status.textContent = "Registration opens at launch — contract deploying."; return; }
  if (!name.endsWith(".ai") || name.length < 4) { status.className = "status err"; status.textContent = "Enter your Agent ID, e.g. yourname.ai"; return; }
  if (!state.signer) { await connectWallet(); if (!state.signer) return; }
  try {
    status.textContent = "Confirm the transaction in your wallet…";
    const tx = await state.contract.register(name);
    await tx.wait();
    status.className = "status ok";
    status.textContent = `Registered ✅ — ${name} is now bound to your wallet on BNB Chain.`;
    renderMyProfile();
  } catch {
    status.className = "status err";
    status.textContent = "Registration failed or was rejected. The name may be taken, or the wallet is not on BNB Chain.";
  }
});

// ---------- wallet ----------
async function connectWallet() {
  if (!window.ethereum) { alert("No wallet found. Open MintRadar in your wallet's browser (e.g. Binance Wallet) or a browser with a Web3 wallet extension."); return; }
  try {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== CFG.BSC_CHAIN_ID) {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
    }
    state.signer = await provider.getSigner();
    state.wallet = await state.signer.getAddress();
    if (CFG.CONTRACT_ADDRESS) state.contract = new ethers.Contract(CFG.CONTRACT_ADDRESS, REGISTRY_ABI, state.signer);
    $("connectBtn").textContent = short(state.wallet);
    hydrateFollowUI();
    renderMyProfile();
  } catch { /* user rejected */ }
}
$("connectBtn").addEventListener("click", connectWallet);

// ---------- routing ----------
function route() {
  const hash = location.hash || "#/radar";
  const parts = hash.replace(/^#\//, "").split("/");
  const view = parts[0] || "radar";
  for (const v of ["radar", "agents", "agent", "leaderboard", "register"]) {
    $("view-" + v).classList.toggle("hidden", v !== view);
  }
  document.querySelectorAll("[data-nav]").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === view || (view === "agent" && a.dataset.nav === "agents"));
  });
  if (view === "agents") renderAgents($("agentSearch").value || "");
  if (view === "agent") renderAgentProfile(decodeURIComponent(parts[1] || ""));
  if (view === "leaderboard") renderLeaderboard();
  if (view === "register") renderMyProfile();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
$("agentSearch").addEventListener("input", (e) => renderAgents(e.target.value));

// ---------- init ----------
(async () => {
  await loadData();
  renderRadar();
  if (CFG.CONTRACT_ADDRESS) {
    $("contractLine").innerHTML = `Registry: <a href="https://bscscan.com/address/${CFG.CONTRACT_ADDRESS}" target="_blank" rel="noopener">${short(CFG.CONTRACT_ADDRESS)}</a>`;
  } else {
    $("contractLine").textContent = "Registry contract: deploying";
  }
  route();
})();
