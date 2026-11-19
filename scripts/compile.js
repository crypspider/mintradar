// Compile MintRadarRegistry.sol with solc-js (optimizer on, viaIR off).
// Writes build/MintRadarRegistry.json with abi + bytecode.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const sourcePath = path.join(__dirname, "..", "contracts", "MintRadarRegistry.sol");
const source = fs.readFileSync(sourcePath, "utf8");

const input = {
  language: "Solidity",
  sources: { "MintRadarRegistry.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.gasEstimates"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
if (output.errors) {
  for (const e of output.errors) {
    console.log(e.formattedMessage);
    if (e.severity === "error") process.exitCode = 1;
  }
  if (process.exitCode) process.exit(1);
}

const c = output.contracts["MintRadarRegistry.sol"]["MintRadarRegistry"];
const outDir = path.join(__dirname, "..", "build");
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "MintRadarRegistry.json"),
  JSON.stringify({ abi: c.abi, bytecode: c.evm.bytecode.object, compiler: solc.version() }, null, 2)
);
console.log("compiler:", solc.version());
console.log("bytecode bytes:", c.evm.bytecode.object.length / 2);
console.log("creation gas estimate:", c.evm.gasEstimates.creation.totalCost);
