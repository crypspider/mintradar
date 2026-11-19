// Local EVM test: deploy MintRadarRegistry to an in-process ganache chain and
// exercise register / follow / unfollow / rename / error paths with ethers v6.
// Revert checks use raw eth_call so the exact custom-error selector is decoded.
const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

const artifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "build", "MintRadarRegistry.json"), "utf8")
);
const iface = new ethers.Interface(artifact.abi);
const errSelectors = {};
for (const f of artifact.abi) {
  if (f.type === "error") {
    const sig = `${f.name}(${(f.inputs || []).map((i) => i.type).join(",")})`;
    errSelectors[ethers.id(sig).slice(0, 10)] = f.name;
  }
}

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log("PASS", name); }
  else { failed++; console.log("FAIL", name); }
}

let raw = null; // ganache provider (EIP-1193)
let contractAddress = null;
async function expectRevert(name, from, fn, args, errName) {
  const data = iface.encodeFunctionData(fn, args);
  try {
    await raw.request({ method: "eth_call", params: [{ from, to: contractAddress, data }, "latest"] });
    failed++; console.log("FAIL (no revert)", name);
  } catch (e) {
    const d = e.data || (e.error && e.error.data) || "";
    const sel = typeof d === "string" ? d.slice(0, 10) : "";
    const got = errSelectors[sel];
    if (got === errName) { passed++; console.log("PASS revert", name, "->", errName); }
    else { failed++; console.log("FAIL revert (wrong error)", name, "expected", errName, "got", got || sel || String(e.message).slice(0, 140)); }
  }
}

(async () => {
  raw = ganache.provider();
  const provider = new ethers.BrowserProvider(raw);
  const signers = [];
  for (let i = 0; i < 4; i++) signers.push(await provider.getSigner(i));
  const [alice, bob, carol, dave] = signers;
  const [aA, aB, aC, aD] = await Promise.all(signers.map((s) => s.getAddress()));

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, alice);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  contractAddress = await contract.getAddress();
  console.log("deployed at", contractAddress);
  check("deploy", ethers.isAddress(contractAddress));

  // --- registration ---
  await (await contract.connect(alice).register("crypspider.ai")).wait();
  check("alice registered", (await contract.agentIdOf(aA)) === "crypspider.ai");
  check("name resolves to alice",
    (await contract.addressOfName(ethers.keccak256(ethers.toUtf8Bytes("crypspider.ai")))) === aA);
  check("registeredCount = 1", (await contract.registeredCount()) === 1n);

  await expectRevert("empty name", aB, "register", [""], "EmptyAgentId");
  await expectRevert("non-.ai name", aB, "register", ["bob.eth"], "AgentIdNotDotAi");
  await expectRevert("name taken", aB, "register", ["crypspider.ai"], "AgentIdTaken");
  await expectRevert("name taken, different case", aB, "register", ["CrypSpider.ai"], "AgentIdTaken");
  await expectRevert("too long", aB, "register", ["a".repeat(62) + ".ai"], "AgentIdTooLong");

  await (await contract.connect(bob).register("0xshenyuan.ai")).wait();
  await (await contract.connect(carol).register("folio.ai")).wait();
  check("registeredCount = 3", (await contract.registeredCount()) === 3n);

  // --- follow graph ---
  await expectRevert("unregistered cannot follow", aD, "follow", [aB], "NotRegistered");
  await expectRevert("cannot follow self", aA, "follow", [aA], "CannotFollowSelf");
  await expectRevert("cannot follow unregistered", aA, "follow", [aD], "TargetNotRegistered");

  await (await contract.connect(alice).follow(aB)).wait();
  check("alice follows bob", await contract.isFollowing(aA, aB));
  check("bob followerCount = 1", (await contract.followerCount(aB)) === 1n);
  check("alice followingCount = 1", (await contract.followingCount(aA)) === 1n);
  await expectRevert("double follow", aA, "follow", [aB], "AlreadyFollowing");

  await (await contract.connect(carol).follow(aB)).wait();
  check("bob followerCount = 2", (await contract.followerCount(aB)) === 2n);

  await (await contract.connect(alice).unfollow(aB)).wait();
  check("alice unfollowed bob", !(await contract.isFollowing(aA, aB)));
  check("bob followerCount back to 1", (await contract.followerCount(aB)) === 1n);
  await expectRevert("double unfollow", aA, "unfollow", [aB], "NotFollowing");

  // --- rename frees the old name ---
  await (await contract.connect(carol).register("folio2.ai")).wait();
  check("carol renamed", (await contract.agentIdOf(aC)) === "folio2.ai");
  check("old name freed",
    (await contract.addressOfName(ethers.keccak256(ethers.toUtf8Bytes("folio.ai")))) === ethers.ZeroAddress);
  check("rename does not duplicate registration", (await contract.registeredCount()) === 3n);
  await (await contract.connect(dave).register("folio.ai")).wait();
  check("dave can take freed name", (await contract.agentIdOf(aD)) === "folio.ai");

  // --- pagination ---
  const page = await contract.getRegisteredAgents(0, 2);
  check("page 1 has 2", page.length === 2 && page[0] === aA);
  const page2 = await contract.getRegisteredAgents(2, 10);
  check("page 2 has rest", page2.length === 2);
  const pageEmpty = await contract.getRegisteredAgents(99, 10);
  check("out-of-range page empty", pageEmpty.length === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
