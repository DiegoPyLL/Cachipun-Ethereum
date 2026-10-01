// Capa de contrato de la DApp: ABI, enums, redes y cálculo del hash.
// En el navegador "ethers" se resuelve con el import map de index.html (CDN);
// en los tests de Node se resuelve desde node_modules. Así ambos usan este mismo archivo.
import { ethers } from "ethers";

export const Jugada = Object.freeze({ Ninguna: 0, Piedra: 1, Papel: 2, Tijera: 3 });
export const NOMBRE_JUGADA = ["—", "Piedra", "Papel", "Tijera"];
export const EMOJI_JUGADA = ["·", "✊", "✋", "✌️"];

export const Estado = Object.freeze({
  EsperandoJugadores: 0,
  Comprometiendo: 1,
  Revelando: 2,
  Finalizado: 3,
  Cancelado: 4,
});
export const NOMBRE_ESTADO = ["Esperando jugadores", "Fase de commit", "Fase de reveal", "Finalizada", "Anulada"];

// ABI legible para humanos: los enums del contrato viajan como uint8.
export const ABI = [
  "function commit(bytes32 hash) payable",
  "function reveal(uint8 jugada, bytes32 secreto)",
  "function reclamarTimeout()",
  "function nuevaPartida()",
  "function retirar()",
  "function generarHash(uint8 jugada, bytes32 secreto, address jugador) pure returns (bytes32)",
  "function partida() view returns (uint256)",
  "function ronda() view returns (uint256)",
  "function estado() view returns (uint8)",
  "function ganador() view returns (address)",
  "function porAbandono() view returns (bool)",
  "function jugador1() view returns (address addr, uint8 jugada, bool comprometio, bool revelo, uint8 victorias, bytes32 hash, bytes32 ultimoSecreto)",
  "function jugador2() view returns (address addr, uint8 jugada, bool comprometio, bool revelo, uint8 victorias, bytes32 hash, bytes32 ultimoSecreto)",
  "function apuesta() view returns (uint256)",
  "function plazoCommit() view returns (uint256)",
  "function plazoReveal() view returns (uint256)",
  "function pendientes(address) view returns (uint256)",
  "function duracionCommit() view returns (uint256)",
  "function duracionReveal() view returns (uint256)",
  "function bloqueDespliegue() view returns (uint256)",
  "event NuevaPartida(uint256 indexed partida)",
  "event Commit(uint256 indexed partida, uint256 ronda, address indexed jugador, bytes32 hash, uint256 monto)",
  "event Reveal(uint256 indexed partida, uint256 ronda, address indexed jugador, uint8 jugada)",
  "event RondaGanada(uint256 indexed partida, uint256 ronda, address indexed ganador, uint8 victorias1, uint8 victorias2)",
  "event Empate(uint256 indexed partida, uint256 ronda)",
  "event Ganador(uint256 indexed partida, address indexed ganador, uint256 premio, bool porAbandono)",
  "event Anulado(uint256 indexed partida, string motivo)",
  "event PagoPendiente(address indexed destinatario, uint256 monto)",
  "event Retiro(address indexed destinatario, uint256 monto)",
];

// Redes soportadas. El RPC se usa en modo espectador (sin wallet).
export const REDES = {
  sepolia: {
    chainId: 11155111n,
    nombre: "Sepolia",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    fuente: "RPC público",
    explorador: "https://sepolia.etherscan.io",
  },
  local: {
    chainId: 31337n,
    nombre: "Hardhat local",
    rpc: "http://127.0.0.1:8545",
    fuente: "nodo local",
    explorador: null,
  },
};

export function redPorChainId(chainId) {
  return Object.values(REDES).find((red) => red.chainId === BigInt(chainId)) ?? null;
}

/** Mismo cálculo que generarHash del contrato: keccak256(abi.encodePacked(jugada, secreto, direccion)). */
export function calcularHash(jugada, secreto, direccion) {
  return ethers.solidityPackedKeccak256(["uint8", "bytes32", "address"], [jugada, secreto, direccion]);
}

/** Secreto aleatorio de 32 bytes, del generador criptográfico del sistema. */
export function nuevoSecreto() {
  return ethers.hexlify(ethers.randomBytes(32));
}

export function conectarContrato(direccion, proveedorOFirmante) {
  return new ethers.Contract(direccion, ABI, proveedorOFirmante);
}
