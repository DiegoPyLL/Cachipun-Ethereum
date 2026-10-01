// Despliega Cachipun en el nodo local de Hardhat.
// Uso: `npm run nodo` en una terminal y `npm run desplegar:local` en otra.
// Los plazos se pueden cambiar con DURACION_COMMIT y DURACION_REVEAL (segundos).
const { ethers, network } = require("hardhat");

async function main() {
  const duracionCommit = Number(process.env.DURACION_COMMIT ?? 120);
  const duracionReveal = Number(process.env.DURACION_REVEAL ?? 120);

  const juego = await ethers.deployContract("Cachipun", [duracionCommit, duracionReveal]);
  await juego.waitForDeployment();
  const direccion = await juego.getAddress();

  console.log(`Cachipun desplegado en la red "${network.name}": ${direccion}`);
  console.log(`Plazos: commit ${duracionCommit} s · reveal ${duracionReveal} s`);
  console.log(`DApp: http://localhost:8080/?red=local&contrato=${direccion}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
