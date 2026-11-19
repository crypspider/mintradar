// BSC mainnet FORK rehearsal: deploy MintRadarRegistry on a local fork of BSC
// mainnet, from Emmanuel's real Agentic Wallet address (unlocked on the fork
// only — nothing touches the real chain), then run his register() as
// interaction #1 and a follow from a second real agent address.
const fs = require("fs");
const path = require("path");
const ganache = require("ganache");
const { ethers } = require("ethers");

const artifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "build", "MintRadarRegistry.json"), "utf8")
);
const rpc = fs.readFileSync(path.join(__dirname, "..", "..", "wallet-watch", "alchemy_rpc.txt"), "utf8").trim();

const EMMANUEL = "0x904B04b0420ae86dB7f75e00922AcC2F0855D311";
const SHENYUAN = "0x7bd58464589f45a12c6bb958fb813cdedb4991d7"; // 0xshenyuan.ai

(async () => {
  const raw = ganache.provider({
    fork: { url: rpc },
    wallet: { unlockedAccounts: [EMMANUEL, SHENYUAN] },
    logging: { quiet: true },
  });
  const provider = new ethers.BrowserProvider(raw);
  const block = await provider.getBlockNumber();
  console.log("fork block:", block);
  const bal = await provider.getBalance(EMMANUEL);
  console.log("fork balance (BNB):", ethers.formatEther(bal));

  const emmanuel = await provider.getSigner(EMMANUEL);
  const shenyuan = await provider.getSigner(SHENYUAN);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, emmanuel);
  const deployTx = await factory.getDeployTransaction();
  const gasEst = await provider.estimateGas({ ...deployTx, from: EMMANUEL });
  console.log("deploy gas estimate on fork:", gasEst.toString());

  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log("fork contract:", addr);

  const gasPrice = (await provider.getFeeData()).gasPrice;
  console.log("fork gas price (gwei):", ethers.formatUnits(gasPrice, "gwei"));

  let tx = await contract.connect(emmanuel).register("crypspider.ai");
  let rc = await tx.wait();
  console.log("register crypspider.ai: status", rc.status, "gasUsed", rc.gasUsed.toString());

  tx = await contract.connect(shenyuan).register("0xshenyuan.ai");
  rc = await tx.wait();
  console.log("register 0xshenyuan.ai: status", rc.status, "gasUsed", rc.gasUsed.toString());

  tx = await contract.connect(emmanuel).follow(SHENYUAN);
  rc = await tx.wait();
  console.log("emmanuel follows shenyuan: status", rc.status, "gasUsed", rc.gasUsed.toString());

  console.log("agentIdOf(emmanuel):", await contract.agentIdOf(EMMANUEL));
  console.log("followerCount(shenyuan):", (await contract.followerCount(SHENYUAN)).toString());
  console.log("registeredCount:", (await contract.registeredCount()).toString());
  const balAfter = await provider.getBalance(EMMANUEL);
  console.log("emmanuel fork BNB spent:", ethers.formatEther(bal - balAfter));
  console.log("FORK REHEARSAL OK");
})().catch((e) => { console.error("FORK TEST FAILED:", e.message); process.exit(1); });
