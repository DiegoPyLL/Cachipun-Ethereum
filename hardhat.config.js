require("@nomicfoundation/hardhat-toolbox");
const { vars } = require("hardhat/config");

// Datos para Sepolia. Se guardan FUERA del repositorio con `npx hardhat vars set NOMBRE`:
//   SEPOLIA_PRIVATE_KEY  llave privada de una cuenta SOLO de pruebas (obligatoria para desplegar)
//   SEPOLIA_RPC_URL      URL de Alchemy/Infura (opcional; si no, se usa un RPC público)
//   ETHERSCAN_API_KEY    para verificar el código en Etherscan (opcional)
const SEPOLIA_RPC_URL = vars.get("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com");
const cuentasSepolia = vars.has("SEPOLIA_PRIVATE_KEY") ? [vars.get("SEPOLIA_PRIVATE_KEY")] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    // Igual que Remix por defecto: sin optimizador y EVM cancun.
    settings: { evmVersion: "cancun" },
  },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts: cuentasSepolia,
    },
  },
  etherscan: {
    apiKey: vars.get("ETHERSCAN_API_KEY", ""),
  },
  sourcify: {
    enabled: false,
  },
  gasReporter: {
    // `npm run gas` activa el reporte de gas por función y por despliegue.
    enabled: process.env.REPORT_GAS === "true",
    showMethodSig: false,
  },
};
