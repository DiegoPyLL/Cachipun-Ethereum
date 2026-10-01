require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    // Igual que Remix por defecto: sin optimizador y EVM cancun.
    settings: { evmVersion: "cancun" },
  },
  gasReporter: {
    // `npm run gas` activa el reporte de gas por función y por despliegue.
    enabled: process.env.REPORT_GAS === "true",
    showMethodSig: false,
  },
};
