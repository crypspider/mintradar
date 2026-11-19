// Deploy MintRadarRegistry to BSC mainnet from the deployer wallet.
// Key is read from deployer_key.txt (mode 600, gitignored) and never printed.
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

(async () => {
  const artifact = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "build", "MintRadarRegistry.json"), "utf8")
  );
  const key = fs.readFileSync(path.join(__dirname, "..", "deployer_key.txt"), "utf8").trim();
  const rpc = fs.readFileSync(path.join(__dirname, "..", "..", "wallet-watch", "alchemy_rpc.txt"), "utf8").trim();
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(key, provider);
  console.log("deployer:", wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log("balance BNB:", ethers.formatEther(bal));
  if (bal < ethers.parseEther("0.0002")) { console.error("insufficient balance"); process.exit(1); }

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  const deployTx = contract.deploymentTransaction();
  console.log("deploy tx:", deployTx.hash);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  const receipt = await provider.getTransactionReceipt(deployTx.hash);
  const fee = receipt.gasUsed * receipt.gasPrice;
  console.log("contract:", addr);
  console.log("block:", receipt.blockNumber, "status:", receipt.status);
  console.log("gasUsed:", receipt.gasUsed.toString(), "fee BNB:", ethers.formatEther(fee));
  console.log("code size:", (await provider.getCode(addr)).length / 2 - 1, "bytes");

  // Smoke test the live contract with a read.
  console.log("registeredCount:", (await contract.registeredCount()).toString());

  fs.writeFileSync(
    path.join(__dirname, "..", "build", "deployment.json"),
    JSON.stringify({
      contract: addr,
      deployTx: deployTx.hash,
      block: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      feeBnb: ethers.formatEther(fee),
      deployer: wallet.address,
      chainId: 56,
    }, null, 2)
  );
  console.log("saved build/deployment.json");
})().catch((e) => { console.error("DEPLOY FAILED:", e.message); process.exit(1); });
