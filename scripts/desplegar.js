// Despliega Cachipun en la red indicada con --network.
//   Local:   `npm run nodo` en una terminal y `npm run desplegar:local` en otra.
//   Sepolia: `npm run desplegar:sepolia` (antes: `npx hardhat vars set SEPOLIA_PRIVATE_KEY`).
// Los plazos se cambian con las variables de entorno DURACION_COMMIT y DURACION_REVEAL (segundos).
const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");
const { ethers, network } = hre;

// Cómo se llama cada red en la DApp (?red=...) y dónde se ven sus transacciones.
const REDES = {
  localhost: { dapp: "local", explorador: null },
  sepolia: { dapp: "sepolia", explorador: "https://sepolia.etherscan.io" },
};

async function main() {
  const red = REDES[network.name];
  if (!red) {
    throw new Error(`Usa --network localhost o --network sepolia (la red "${network.name}" no sirve para desplegar).`);
  }
  const esTestnet = network.name !== "localhost";
  const porDefecto = esTestnet ? 300 : 120;
  const duracionCommit = Number(process.env.DURACION_COMMIT ?? porDefecto);
  const duracionReveal = Number(process.env.DURACION_REVEAL ?? porDefecto);

  const [cuenta] = await ethers.getSigners();
  if (!cuenta) {
    throw new Error(
      `No hay una cuenta para desplegar en ${network.name}. Guarda su llave privada con:\n` +
        "  npx hardhat vars set SEPOLIA_PRIVATE_KEY"
    );
  }

  // Se estima el costo antes de enviar nada, para avisar si falta ETH.
  const fabrica = await ethers.getContractFactory("Cachipun");
  const txDespliegue = await fabrica.getDeployTransaction(duracionCommit, duracionReveal);
  const [{ chainId }, saldo, gas, tarifas] = await Promise.all([
    ethers.provider.getNetwork(),
    ethers.provider.getBalance(cuenta.address),
    ethers.provider.estimateGas({ ...txDespliegue, from: cuenta.address }),
    ethers.provider.getFeeData(),
  ]);
  const costoMaximo = gas * (tarifas.maxFeePerGas ?? tarifas.gasPrice);

  console.log(`Red:     ${network.name} (chainId ${chainId})`);
  console.log(`Cuenta:  ${cuenta.address}`);
  console.log(`Saldo:   ${ethers.formatEther(saldo)} ETH`);
  console.log(`Plazos:  commit ${duracionCommit} s · reveal ${duracionReveal} s`);
  console.log(`Gas:     ${gas.toLocaleString("es-CL")} (costo máximo ≈ ${ethers.formatEther(costoMaximo)} ETH)`);
  if (saldo < costoMaximo) {
    throw new Error("Saldo insuficiente para desplegar: pide ETH de Sepolia en un faucet y vuelve a intentar.");
  }

  const juego = await fabrica.deploy(duracionCommit, duracionReveal);
  const tx = juego.deploymentTransaction();
  console.log(`\nTransacción enviada: ${tx.hash}`);
  if (red.explorador) console.log(`  ${red.explorador}/tx/${tx.hash}`);
  const recibo = await tx.wait();
  const direccion = await juego.getAddress();
  const linkDapp = `http://localhost:8080/?red=${red.dapp}&contrato=${direccion}`;

  console.log(`\nCachipun desplegado en ${network.name}`);
  console.log(`  Contrato:  ${direccion}`);
  console.log(`  Bloque:    ${recibo.blockNumber} · gas usado ${recibo.gasUsed.toLocaleString("es-CL")}`);
  if (red.explorador) console.log(`  Etherscan: ${red.explorador}/address/${direccion}`);
  console.log(`  DApp:      ${linkDapp}  (con \`npm run dapp\` corriendo)`);

  if (!esTestnet) return;

  // Registro del despliegue: evidencia para el informe y la entrega en AVA.
  const bloque = await ethers.provider.getBlock(recibo.blockNumber);
  const registro = {
    red: network.name,
    chainId: chainId.toString(),
    contrato: direccion,
    transaccion: tx.hash,
    bloque: recibo.blockNumber,
    fecha: new Date(bloque.timestamp * 1000).toISOString(),
    desplegadoPor: cuenta.address,
    duracionCommit,
    duracionReveal,
    gasUsado: recibo.gasUsed.toString(),
    etherscan: `${red.explorador}/address/${direccion}`,
    dapp: linkDapp,
  };
  const archivo = path.join(__dirname, "..", "despliegues", `${network.name}.json`);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, `${JSON.stringify(registro, null, 2)}\n`);
  console.log(`  Registro:  despliegues/${network.name}.json`);

  const comandoVerificar = `npx hardhat verify --network ${network.name} ${direccion} ${duracionCommit} ${duracionReveal}`;
  if (!hre.config.etherscan.apiKey) {
    console.log("\nPara publicar el código fuente en Etherscan (recomendado):");
    console.log("  npx hardhat vars set ETHERSCAN_API_KEY");
    console.log(`  ${comandoVerificar}`);
    return;
  }

  // Etherscan necesita unos bloques para indexar el contrato antes de verificarlo.
  console.log("\nEsperando 5 confirmaciones para verificar el código en Etherscan…");
  await tx.wait(5);
  try {
    await hre.run("verify:verify", {
      address: direccion,
      constructorArguments: [duracionCommit, duracionReveal],
    });
  } catch (error) {
    console.log(`No se pudo verificar ahora (${error.message}). Reintenta en un minuto con:`);
    console.log(`  ${comandoVerificar}`);
  }
}

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
});
