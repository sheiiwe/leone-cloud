import { readFile } from "node:fs/promises";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";

const required = ["NFT_RPC_URL", "NFT_DEPLOYER_PRIVATE_KEY", "NFT_ADMIN_ADDRESS", "NFT_MINTER_ADDRESS"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Variabile obbligatoria mancante: ${name}`);
}

const artifactUrl = new URL("../artifacts/contracts/LeoneCredentialNFT.sol/LeoneCredentialNFT.json", import.meta.url);
const artifact = JSON.parse(await readFile(artifactUrl, "utf8"));
const provider = new JsonRpcProvider(process.env.NFT_RPC_URL);
const deployer = new Wallet(process.env.NFT_DEPLOYER_PRIVATE_KEY, provider);
const network = await provider.getNetwork();

if (![80002n, 137n].includes(network.chainId)) {
  throw new Error(`Rete non ammessa: chain ID ${network.chainId}. Usare Polygon Amoy (80002) o Polygon PoS (137).`);
}

const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
const contract = await factory.deploy(process.env.NFT_ADMIN_ADDRESS, process.env.NFT_MINTER_ADDRESS);
await contract.waitForDeployment();
const address = await contract.getAddress();
const deployment = contract.deploymentTransaction();

console.log(JSON.stringify({
  network: network.chainId === 137n ? "polygon" : "polygon-amoy",
  chain_id: network.chainId.toString(),
  contract_address: address,
  transaction_hash: deployment?.hash ?? null,
}, null, 2));
