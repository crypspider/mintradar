// MintRadar app — static site, reads watch data files + the registry contract.
import { ethers } from "https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.min.js";

const CFG = window.MINTRADAR_CONFIG;
// The official on-chain Agent ID registry (SPACE ID, issued for Binance
// Wallet). handleOf(address) returns the wallet's Agent ID handle without
// the ".ai" suffix, or "" when the wallet holds no real Agent ID. This is
// the only honest source for the Verified badge: a name registered on
// MintRadar alone is NOT a Binance Agent ID (cherie.ai is the example).
const AGENT_REGISTRY = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F";
const AGENT_REGISTRY_ABI = [
  "function handleOf(address) view returns (string)",
  "function ownerOfHandle(string) view returns (address)",
];
const verifiedCache = new Map();
async function binanceVerified(name, address) {
  const key = (name || "").toLowerCase() + "|" + (address || "").toLowerCase();
  if (verifiedCache.has(key)) return verifiedCache.get(key);
  let ok = false;
  try {
    const reg = new ethers.Contract(AGENT_REGISTRY, AGENT_REGISTRY_ABI, readProvider());
    const handle = (name || "").toLowerCase().replace(/\.ai$/, "");
    const owner = await reg.ownerOfHandle(handle);
    ok = !!owner && owner !== ethers.ZeroAddress && owner.toLowerCase() === (address || "").toLowerCase();
  } catch { ok = false; }
  verifiedCache.set(key, ok);
  return ok;
}
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
const state = { agents: [], radar: null, wallet: null, signer: null, contract: null, readContract: null, radarQuery: "", radarFilter: "all", eip1193: null, providerName: "" };

// ---------- wallet discovery (EIP-6963) ----------
// Modern wallets announce themselves to the page; we collect every one so
// the visitor picks whichever wallet their browser carries — nothing is
// hardcoded to a single wallet brand.
const discoveredWallets = new Map();
window.addEventListener("eip6963:announceProvider", (e) => {
  const d = e.detail;
  if (d && d.provider && d.info) discoveredWallets.set(d.info.uuid, d);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function candidateProviders() {
  const list = [];
  const seen = new Set();
  const push = (provider, name, icon) => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    list.push({ provider, name, icon });
  };
  if (state.eip1193) push(state.eip1193, state.providerName || "Connected wallet");
  for (const d of discoveredWallets.values()) push(d.provider, d.info.name, d.info.icon);
  if (window.ethereum) {
    const pool = Array.isArray(window.ethereum.providers) ? window.ethereum.providers : [window.ethereum];
    for (const p of pool) push(p, p.isMetaMask ? "MetaMask" : p.isTrust ? "Trust Wallet" : p.isCoinbaseWallet ? "Coinbase Wallet" : "Browser wallet");
  }
  return list;
}

function readProvider() {
  // Several public BSC endpoints behind a fallback provider: if one is
  // rate-limiting or refusing (the original single endpoint started
  // returning 403s), reads quietly move to the next instead of erroring.
  const urls = (CFG.BSC_RPCS && CFG.BSC_RPCS.length) ? CFG.BSC_RPCS : [CFG.BSC_RPC];
  const providers = urls.map((u) => new ethers.JsonRpcProvider(u, CFG.BSC_CHAIN_ID, { staticNetwork: true }));
  if (providers.length === 1) return providers[0];
  return new ethers.FallbackProvider(providers, CFG.BSC_CHAIN_ID, { quorum: 1 });
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
  const latestChip = $("chipLatest");
  if (latestChip) {
    const latest = state.radar.events[0];
    latestChip.textContent = latest ? `📡 ${latest.name} detected` : "📡 Scanning the chain…";
  }
  const q = (state.radarQuery || "").trim().toLowerCase();
  const f = state.radarFilter || "all";
  const events = state.radar.events.filter((ev) => {
    if (f === "nft" || f === "token") { if (ev.kind !== f) return false; }
    if (f === "free" || f === "paid") { if (ev.cost !== f) return false; }
    if (q) {
      const hay = [ev.name, ev.symbol, ev.kind, ev.cost, ...(ev.agents || [])].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!events.length) {
    feed.innerHTML = `<div class="card">No detections match that yet — the radar keeps scanning every few minutes.</div>`;
    return;
  }
  for (const ev of events) {
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
      <div class="event-actions">
        ${ev.cost === "free"
          ? `<button class="btn btn-grad btn-sm" data-mint="${ev.contract}">Mint in your wallet</button>
             <a class="btn btn-ghost btn-sm" href="https://bscscan.com/address/${ev.contract}#writeContract" target="_blank" rel="noopener">BscScan ↗</a>`
          : `<a class="btn btn-grad btn-sm" href="https://bscscan.com/address/${ev.contract}#writeContract" target="_blank" rel="noopener">Mint it yourself ↗</a>`}
        <button class="btn btn-ghost btn-sm" data-copy="${ev.contract}">Copy contract</button>
        <p class="event-agent-note">${ev.cost === "free"
          ? "Free mint — mint it right here into any wallet your browser can connect, or copy the contract and give it to your agent to mint for you."
          : "Paid mint — the price is set by the contract itself. Check it on BscScan before you buy, or ask your agent to check it first."}</p>
      </div>
    `;
    feed.appendChild(div);
    const copyBtn = div.querySelector("[data-copy]");
    if (copyBtn) copyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(copyBtn.dataset.copy); copyBtn.textContent = "Copied ✓"; }
      catch (e) { copyBtn.textContent = "Copy failed — use the address link above"; }
      setTimeout(() => { copyBtn.textContent = "Copy contract"; }, 2000);
    });
    const mintBtn = div.querySelector("[data-mint]");
    if (mintBtn) mintBtn.addEventListener("click", () => openMint(ev));
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
        if (chip) chip.innerHTML = '<span class="vbadge">✓</span>' + count + (count === 1 ? " agent" : " agents") + " registered on-chain";
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
  const c = getReadContract();
  let a = state.agents.find((x) => x.agentId.toLowerCase() === agentId.toLowerCase())
       || state.agents.find((x) => x.address.toLowerCase() === agentId.toLowerCase());
  let regName = null, regAddr = null;
  if (c) {
    try {
      if (/^0x[0-9a-fA-F]{40}$/.test(agentId)) {
        const n = await c.agentIdOf(agentId);
        if (n) { regName = n; regAddr = agentId; }
      } else {
        const addr = await c.addressOfName(ethers.keccak256(ethers.toUtf8Bytes(agentId.toLowerCase())));
        if (addr !== ethers.ZeroAddress) { regName = agentId.toLowerCase(); regAddr = addr; }
      }
    } catch { /* reads are best-effort */ }
  }
  if (!a && !regName) {
    box.innerHTML = `<div class="card">Agent <b class="aaddr">${agentId}</b> is not in the tracked directory and has not registered on MintRadar yet.</div>`;
    return;
  }
  const name = a ? a.agentId : regName;
  const address = a ? a.address : regAddr;
  const eyebrow = a ? `TRACKED AGENT · RANK #${a.rank}` : "REGISTERED AGENT";
  box.innerHTML = `
    <div class="card">
      <div class="arank">${eyebrow}</div>
      <h2 style="margin:6px 0">${name} <span class="badge-verified" id="profBadge"></span></h2>
      <p class="aaddr">${address} · <a href="https://bscscan.com/address/${address}" target="_blank" rel="noopener">Wallet &amp; holdings on BscScan ↗</a></p>
      <div class="row" style="display:flex;gap:18px;align-items:center">
        <span class="followers" data-fcount="${address}">… followers</span>
        <button class="btn btn-gold" data-follow="${address}">Follow</button>
      </div>
      <p class="foot-note"><span class="vbadge">✓</span>Verified means this is a real Binance Agent ID: the official Agent ID registry on BNB Chain (SPACE ID) shows the name belonging to the same wallet that registered it here. A name registered only on MintRadar shows “Registered” instead — registering here alone does not make a Binance Agent ID.</p>
    </div>
    <div class="card"><h3>Recent radar detections</h3><div id="profEvents"></div></div>`;
  const evBox = $("profEvents");
  const evs = state.radar.events.filter((ev) => (ev.agents || []).some((x) => x.toLowerCase() === name.toLowerCase()));
  evBox.innerHTML = evs.length
    ? evs.map((ev) => `<p>📡 <b>${ev.name}</b> — ${fmtDate(ev.at)} · ${ev.note}</p>`).join("")
    : `<p class="sub">No detections in the current feed window.</p>`;
  // Verified badge: the name must be a real Binance Agent ID for this
  // wallet in the official on-chain registry — not just registered here.
  if (c && regAddr && regAddr.toLowerCase() === address.toLowerCase()) {
    if (await binanceVerified(name, address)) {
      $("profBadge").innerHTML = '<span class="vbadge">✓</span>Verified Agent';
    } else {
      $("profBadge").innerHTML = '<span class="reg-tag">Registered on MintRadar</span>';
    }
  }
  hydrateFollowUI();
}

// ---------- leaderboard ----------
async function renderLeaderboard(retried) {
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
    if (!retried) {
      await new Promise((r) => setTimeout(r, 1500));
      return renderLeaderboard(true);
    }
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
  if (name) {
    const [followers, following] = await Promise.all([c.followerCount(state.wallet), c.followingCount(state.wallet)]);
    el.innerHTML = `You are registered as <b>${name}</b> <span class="vbadge">✓</span> · ${Number(followers)} follower${Number(followers) === 1 ? "" : "s"} · following ${Number(following)} · <a href="#/leaderboard">View the leaderboard</a>`;
  } else {
    el.textContent = "This wallet has not registered an Agent ID yet.";
  }
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
    status.textContent = `Registered — ${name} is now bound to your wallet on BNB Chain.`;
    renderMyProfile();
    refreshConnectLabel();
  } catch {
    status.className = "status err";
    status.textContent = "Registration failed or was rejected. The name may be taken, or the wallet is not on BNB Chain.";
  }
});

// ---------- wallet ----------
async function refreshConnectLabel() {
  const navReg = document.querySelector('[data-nav="register"]');
  const heroCta = $("heroCta");
  const formCard = $("regFormCard");
  if (!state.wallet) {
    $("connectBtn").textContent = "Connect Wallet";
    if (navReg) navReg.textContent = "Register";
    if (heroCta) { heroCta.textContent = "Register your Agent ID"; heroCta.setAttribute("href", "#/register"); }
    if (formCard) formCard.classList.remove("hidden");
    return;
  }
  $("connectBtn").textContent = short(state.wallet);
  try {
    const c = getReadContract();
    if (!c) return;
    const name = await c.agentIdOf(state.wallet);
    if (name) {
      // The check disc is earned only by a real Binance Agent ID; a name
      // registered here alone shows without it.
      $("connectBtn").innerHTML = (await binanceVerified(name, state.wallet)) ? '<span class="vbadge">✓</span>' + name : name;
      if (navReg) navReg.textContent = "My Agent";
      if (heroCta) { heroCta.textContent = "View my agent profile"; heroCta.setAttribute("href", "#/agent/" + name); }
      if (formCard) formCard.classList.add("hidden");
    } else {
      if (navReg) navReg.textContent = "Register";
      if (heroCta) { heroCta.textContent = "Register your Agent ID"; heroCta.setAttribute("href", "#/register"); }
      if (formCard) formCard.classList.remove("hidden");
    }
  } catch { /* keep the defaults */ }
}

function closeModals() { for (const m of document.querySelectorAll(".modal")) m.classList.add("hidden"); }
document.querySelectorAll("[data-close-modal]").forEach((b) => b.addEventListener("click", closeModals));
document.querySelectorAll(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));

function attachProviderListeners(p) {
  if (!p || !p.on || p.__mrListening) return;
  p.__mrListening = true;
  p.on("accountsChanged", (accounts) => {
    if (state.eip1193 !== p) return;
    if (accounts && accounts.length) {
      state.wallet = accounts[0];
      refreshConnectLabel();
      hydrateFollowUI();
      renderMyProfile();
    } else {
      state.wallet = null; state.signer = null; state.contract = null;
      refreshConnectLabel();
      renderMyProfile();
    }
  });
  p.on("chainChanged", () => { if (state.eip1193 === p) autoReconnect(); });
}

async function ensureChain(p) {
  const chainId = await p.request({ method: "eth_chainId" });
  if (parseInt(chainId, 16) === CFG.BSC_CHAIN_ID) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
  } catch (e) {
    if (e && e.code === 4902) {
      await p.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x38", chainName: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: ["https://bsc-dataseed2.binance.org"], blockExplorerUrls: ["https://bscscan.com"] }] });
    } else throw e;
  }
}

async function useProvider(entry) {
  const p = entry.provider;
  state.eip1193 = p;
  state.providerName = entry.name;
  attachProviderListeners(p);
  await p.request({ method: "eth_requestAccounts" });
  await ensureChain(p);
  const provider = new ethers.BrowserProvider(p);
  state.signer = await provider.getSigner();
  state.wallet = await state.signer.getAddress();
  if (CFG.CONTRACT_ADDRESS) state.contract = new ethers.Contract(CFG.CONTRACT_ADDRESS, REGISTRY_ABI, state.signer);
  refreshConnectLabel();
  hydrateFollowUI();
  renderMyProfile();
}

function openWalletPicker(onPicked) {
  const listEl = $("walletList");
  const cands = candidateProviders();
  listEl.innerHTML = "";
  if (!cands.length) {
    listEl.innerHTML = `<p class="sub">No wallet detected in this browser. Open MintRadar inside your wallet app's browser (Trust Wallet, MetaMask, Binance Wallet…), or install a wallet extension, then try again. Agent ID wallets can't connect to websites — give the contract to your agent instead.</p>`;
  }
  for (const c of cands) {
    const b = document.createElement("button");
    b.className = "wallet-row";
    b.innerHTML = `${c.icon ? `<img src="${c.icon}" alt="">` : `<span class="wallet-ico">${(c.name || "W").slice(0, 1)}</span>`}<span>${c.name}</span><span class="wsub">Connect</span>`;
    b.addEventListener("click", async () => {
      closeModals();
      try { await useProvider(c); if (onPicked) onPicked(); } catch { /* user rejected */ }
    });
    listEl.appendChild(b);
  }
  $("walletModal").classList.remove("hidden");
}

async function connectWallet(onPicked) {
  if (state.signer && state.wallet) { if (onPicked) onPicked(); return; }
  const cands = candidateProviders();
  if (cands.length === 1) {
    try { await useProvider(cands[0]); if (onPicked) onPicked(); } catch { /* user rejected */ }
    return;
  }
  openWalletPicker(onPicked);
}
$("connectBtn").addEventListener("click", () => connectWallet());

// Silently reconnect a wallet that already authorised this site, so a
// returning user immediately sees their registered agent — no "login" hunt.
// The address alone drives the display (name, profile, follow state); the
// signer is attached when the chain is right, and any action that needs to
// sign will complete the connection on demand.
async function autoReconnect() {
  if (state.wallet) return;
  // Re-dispatch discovery in case a wallet announced itself after load.
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  for (const c of candidateProviders()) {
    try {
      const accounts = await c.provider.request({ method: "eth_accounts" });
      if (!accounts || !accounts.length) continue;
      state.wallet = accounts[0];
      state.eip1193 = c.provider;
      state.providerName = c.name;
      attachProviderListeners(c.provider);
      try {
        const chainId = await c.provider.request({ method: "eth_chainId" });
        if (parseInt(chainId, 16) === CFG.BSC_CHAIN_ID) {
          const provider = new ethers.BrowserProvider(c.provider);
          state.signer = await provider.getSigner();
          state.wallet = await state.signer.getAddress();
          if (CFG.CONTRACT_ADDRESS) state.contract = new ethers.Contract(CFG.CONTRACT_ADDRESS, REGISTRY_ABI, state.signer);
        }
      } catch { /* display-only connection is fine */ }
      refreshConnectLabel();
      hydrateFollowUI();
      renderMyProfile();
      return;
    } catch { /* try the next wallet */ }
  }
}
// Mobile wallet browsers love dropping the connection when you move around;
// re-check silently whenever the page comes back into view.
window.addEventListener("pageshow", () => { autoReconnect(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) autoReconnect(); });

// ---------- in-site minting ----------
// For FREE detections: the site reads the contract's verified ABI from
// Sourcify, picks the public mint function, and test-calls it from the
// visitor's own address first — a closed or gated mint fails the test
// call and is never sent. Unverified contracts fall back to probing the
// common mint signatures. The visitor's wallet signs; the mint lands
// directly in that wallet.
const mintSession = { ev: null, cand: null, qty: 1 };

async function fetchAbi(address) {
  try {
    const r = await fetch(`https://sourcify.dev/server/v2/contract/56/${address}?fields=abi`);
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.abi) ? j.abi : null;
  } catch { return null; }
}

function mintCandidates(abi) {
  const rank = (name) => {
    const n = (name || "").toLowerCase();
    if (n === "mint") return 0;
    if (n.includes("mint")) return 1;
    if (n.includes("claim")) return 2;
    return 3;
  };
  const fromAbi = [];
  if (abi) {
    for (const f of abi) {
      if (f.type !== "function") continue;
      if (f.stateMutability === "view" || f.stateMutability === "pure") continue;
      if (!/mint|claim/i.test(f.name || "")) continue;
      const ins = f.inputs || [];
      const okShape = ins.length === 0
        || (ins.length === 1 && (ins[0].type === "address" || /^uint/.test(ins[0].type)))
        || (ins.length === 2 && ins.some((i) => i.type === "address") && ins.some((i) => /^uint/.test(i.type)));
      if (!okShape) continue;
      fromAbi.push({
        name: f.name,
        inputs: ins.map((i) => i.type),
        frag: `function ${f.name}(${ins.map((i) => i.type).join(",")})${f.stateMutability === "payable" ? " payable" : ""}`,
      });
    }
  }
  fromAbi.sort((a, b) => rank(a.name) - rank(b.name) || a.inputs.length - b.inputs.length);
  const probes = [
    { name: "mint", inputs: ["uint256"], frag: "function mint(uint256)" },
    { name: "mint", inputs: [], frag: "function mint()" },
    { name: "publicMint", inputs: ["uint256"], frag: "function publicMint(uint256)" },
    { name: "mintFree", inputs: ["uint256"], frag: "function mintFree(uint256)" },
    { name: "freeMint", inputs: ["uint256"], frag: "function freeMint(uint256)" },
  ];
  const seen = new Set(fromAbi.map((c) => c.frag));
  return [...fromAbi, ...probes.filter((p) => !seen.has(p.frag))];
}

function candSig(cand) { return `${cand.name}(${cand.inputs.join(",")})`; }
function candArgs(cand, qty, me) {
  if (!cand.inputs.length) return [];
  if (cand.inputs.length === 1) return [cand.inputs[0] === "address" ? me : qty];
  return cand.inputs.map((t) => (t === "address" ? me : qty));
}

async function openMint(ev) {
  mintSession.ev = ev; mintSession.qty = 1; mintSession.cand = null;
  if (!state.signer) {
    closeModals();
    if (!candidateProviders().length) {
      $("mintTitle").textContent = `Mint ${ev.name}`;
      $("mintBody").innerHTML = `<p class="sub">No wallet detected in this browser. Open MintRadar inside your wallet app's browser (Trust Wallet, MetaMask, Binance Wallet…) and tap Mint again — or copy the contract and give it to your agent to mint for you.</p>`;
      $("mintModal").classList.remove("hidden");
      return;
    }
    await connectWallet(() => openMint(ev));
    return;
  }
  $("mintTitle").textContent = `Mint ${ev.name}`;
  $("mintBody").innerHTML = `<p class="sub">Checking the contract and preparing your mint…</p>`;
  $("mintModal").classList.remove("hidden");
  await prepareMint();
}

async function explainMintBlock(ev, abi, lastErr) {
  const generic = "This mint can't be completed here right now — it may have just closed, or it needs something extra (an allowlist spot, a proof, or a different step). Nothing was sent, and no gas was spent.";
  try {
    if (abi) {
      // Agent-ID gate? The contract itself points at the registry it checks.
      const hasReg = abi.some((f) => f.type === "function" && f.name === "agentIdRegistry");
      if (hasReg) {
        const c = new ethers.Contract(ev.contract, ["function agentIdRegistry() view returns (address)"], readProvider());
        const regAddr = await c.agentIdRegistry();
        const reg = new ethers.Contract(regAddr, AGENT_REGISTRY_ABI, readProvider());
        const handle = await reg.handleOf(state.wallet);
        if (!handle) {
          return `This mint is <b>only for verified Binance Agent ID wallets</b>. The contract checked the official Agent ID registry, and your connected wallet (${state.providerName || "your wallet"} · ${short(state.wallet)}) doesn't hold a Binance Agent ID, so it refused the mint. Nothing was sent, and no gas was spent.<br><br>Hold an Agent ID? Copy the contract below and give it to your agent to mint for you — or connect the wallet that holds your Agent ID and try again.`;
        }
      }
      // Sold out?
      const names = new Set(abi.filter((f) => f.type === "function").map((f) => f.name));
      const mintedFn = ["totalMinted", "totalSupply"].find((n) => names.has(n));
      const maxFn = ["MAX_SUPPLY", "maxSupply"].find((n) => names.has(n));
      if (mintedFn && maxFn) {
        const c = new ethers.Contract(ev.contract, abi, readProvider());
        const [m, mx] = await Promise.all([c[mintedFn](), c[maxFn]()]);
        if (BigInt(m) >= BigInt(mx)) return `This mint is <b>sold out</b> — all ${Number(mx).toLocaleString()} pieces have already been minted. Nothing was sent, and no gas was spent.`;
      }
      // The contract's own named reason?
      const data = lastErr && (lastErr.data || (lastErr.info && lastErr.info.error && lastErr.info.error.data));
      if (data && data !== "0x") {
        let ename = "";
        try { const p = new ethers.Interface(abi).parseError(data); if (p) ename = p.name; } catch { /* unknown custom error */ }
        if (/already/i.test(ename)) return `Your connected wallet has <b>already minted</b> this one — it's limited to one per wallet. Nothing was sent, and no gas was spent.`;
        if (/allowlist|whitelist|merkle|proof|eligible/i.test(ename)) return `This mint is <b>allowlist-gated</b> — your connected wallet isn't on its list, so the contract refused it. Nothing was sent, and no gas was spent.`;
        if (/closed|paused|notstarted|notopen|ended|inactive|notlive/i.test(ename)) return `This mint is <b>not open right now</b> — it hasn't started yet, or it has already closed. Nothing was sent, and no gas was spent.`;
        if (/supply|max|exceed|sold/i.test(ename)) return `This mint has <b>hit its supply limit</b>. Nothing was sent, and no gas was spent.`;
        if (ename) return `${generic}<br><br><span style="font-size:13px">The contract's own reason: <code>${ename}</code></span>`;
      }
    }
  } catch { /* fall through to the generic message */ }
  return generic;
}

async function prepareMint() {
  const ev = mintSession.ev;
  const body = $("mintBody");
  body.innerHTML = `<p class="sub">Reading the contract's verified mint function…</p>`;
  const abi = await fetchAbi(ev.contract);
  const cands = mintCandidates(abi);
  let lastErr = null;
  for (const cand of cands) {
    try {
      const c = new ethers.Contract(ev.contract, [cand.frag], state.signer);
      await c.getFunction(candSig(cand)).staticCall(...candArgs(cand, mintSession.qty, state.wallet), { value: 0n });
      mintSession.cand = cand;
      break;
    } catch (e) { lastErr = e; /* try the next candidate shape */ }
  }
  if (!mintSession.cand) {
    const why = await explainMintBlock(ev, abi, lastErr);
    body.innerHTML = `
      <p class="sub">${why}</p>
      <div class="event-actions">
        <a class="btn btn-grad btn-sm" href="https://bscscan.com/address/${ev.contract}#writeContract" target="_blank" rel="noopener">Open it on BscScan ↗</a>
        <button class="btn btn-ghost btn-sm" data-copy2="${ev.contract}">Copy contract</button>
      </div>
      <p class="foot-note">MintRadar test-calls every mint from your own address first, so a refused mint never costs you gas.</p>`;
    const cb = body.querySelector("[data-copy2]");
    if (cb) cb.addEventListener("click", async () => { try { await navigator.clipboard.writeText(ev.contract); cb.textContent = "Copied ✓"; } catch { /* clipboard unavailable */ } });
    return;
  }
  renderMintReady();
}

function renderMintReady() {
  const ev = mintSession.ev;
  const cand = mintSession.cand;
  const hasQty = cand.inputs.some((t) => /^uint/.test(t));
  $("mintBody").innerHTML = `
    <div class="mint-kv"><span>Token</span><b>${ev.name} ($${ev.symbol})</b></div>
    <div class="mint-kv"><span>Cost</span><b>Free — gas only</b></div>
    <div class="mint-kv"><span>Minting into</span><b>${state.providerName || "Your wallet"} · ${short(state.wallet)}</b></div>
    ${hasQty ? `<div class="mint-qty"><span style="color:var(--muted);font-weight:600">Quantity</span><button class="qty-btn" id="qtyMinus">−</button><span class="qty-num" id="qtyNum">${mintSession.qty}</span><button class="qty-btn" id="qtyPlus">+</button></div>` : ""}
    <button class="btn btn-grad btn-lg" id="mintGo" style="width:100%">Mint now</button>
    <p class="mint-status" id="mintStatus"></p>
    <p class="foot-note">Your wallet will ask you to confirm. MintRadar never touches your keys or your funds.</p>`;
  if (hasQty) {
    $("qtyMinus").addEventListener("click", () => { if (mintSession.qty > 1) { mintSession.qty--; $("qtyNum").textContent = mintSession.qty; } });
    $("qtyPlus").addEventListener("click", () => { if (mintSession.qty < 20) { mintSession.qty++; $("qtyNum").textContent = mintSession.qty; } });
  }
  $("mintGo").addEventListener("click", doMint);
}

async function doMint() {
  const ev = mintSession.ev;
  const cand = mintSession.cand;
  const status = $("mintStatus");
  const go = $("mintGo");
  go.disabled = true;
  status.className = "mint-status";
  status.textContent = "Confirm the mint in your wallet…";
  try {
    const c = new ethers.Contract(ev.contract, [cand.frag], state.signer);
    const tx = await c.getFunction(candSig(cand))(...candArgs(cand, mintSession.qty, state.wallet), { value: 0n });
    status.textContent = "Sent — waiting for the chain to confirm…";
    const rc = await tx.wait();
    status.className = "mint-status ok";
    status.innerHTML = `Minted — ${ev.name} is now in your wallet. <a href="https://bscscan.com/tx/${rc.hash}" target="_blank" rel="noopener">View the transaction ↗</a>`;
    go.textContent = "Minted ✓";
  } catch {
    go.disabled = false;
    status.className = "mint-status err";
    status.textContent = "The mint didn't go through — it may have just closed, or the wallet rejected it. If a transaction was sent, only gas was spent.";
  }
}

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
  if (!state.wallet) autoReconnect();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
$("agentSearch").addEventListener("input", (e) => renderAgents(e.target.value));
$("radarSearch").addEventListener("input", (e) => { state.radarQuery = e.target.value; renderRadar(); });
document.querySelectorAll("[data-rfilter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("[data-rfilter]").forEach((b) => b.classList.toggle("active", b === btn));
    state.radarFilter = btn.dataset.rfilter;
    renderRadar();
  });
});
document.querySelectorAll("[data-gofilter]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const f = link.dataset.gofilter;
    state.radarFilter = f;
    document.querySelectorAll("[data-rfilter]").forEach((b) => b.classList.toggle("active", b.dataset.rfilter === f));
    renderRadar();
    const head = $("feedHead");
    if (head) head.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

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
  autoReconnect();
})();
